using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

/// Global transpiler state: which types are transpiled, how every symbol is named in TS,
/// which external (BCL / Godot / excluded game) symbols the output depends on.
public class Ctx
{
    public static readonly SymbolEqualityComparer SE = SymbolEqualityComparer.Default;
    public CSharpCompilation Comp = null!;
    public readonly HashSet<INamedTypeSymbol> Included = new(SE);
    public readonly List<INamedTypeSymbol> Ordered = new();
    readonly Dictionary<INamedTypeSymbol, string> typeIds = new(SE);
    readonly HashSet<string> usedIds = new();
    public readonly Dictionary<INamedTypeSymbol, string> ExtAliases = new(SE);
    public readonly Dictionary<INamedTypeSymbol, HashSet<ISymbol>> ExtUses = new(SE);
    public readonly SortedDictionary<string, int> BclUses = new(StringComparer.Ordinal);
    public readonly List<string> Warnings = new();
    public readonly HashSet<string> BeforeFieldInit = new();
    readonly Dictionary<ISymbol, string> memberNames = new(SE);

    public static readonly HashSet<string> JsGlobals = new() {
        "Math","Object","Array","String","Number","Boolean","Error","Map","Set","WeakMap","WeakSet","Promise","Symbol","JSON","Date",
        "RegExp","Function","Reflect","Proxy","console","window","globalThis","undefined","NaN","Infinity","eval","arguments","Iterator",
        "TypeError","RangeError","Intl","BigInt","Atomics","DataView","ArrayBuffer","Uint8Array","Int32Array","Float32Array","Float64Array",
        "Event","Node","Element","Document","Image","Text","Audio","Request","Response","Headers","Worker","Storage","Location","History",
        "Animation","Range","Selection","Screen","Performance","Notification","Blob","File","URL","Option","Comment","Attr","Plugin","Touch",
    };
    public static readonly HashSet<string> JsReserved = new() {
        "break","case","catch","class","const","continue","debugger","default","delete","do","else","enum","export","extends","false",
        "finally","for","function","if","import","in","instanceof","new","null","return","super","switch","this","throw","true","try",
        "typeof","var","void","while","with","yield","let","static","implements","interface","package","private","protected","public",
        "await","arguments","eval","undefined","NaN","Infinity","of","async","get","set",
    };

    public static string SafeLocal(string n)
    {
        n = CleanName(n);
        return JsReserved.Contains(n) || JsGlobals.Contains(n) ? n + "_" : n;
    }

    /// ILSpy escapes compiler-generated names like <>c as _003C_003Ec.
    public static string CleanName(string n)
    {
        n = n.TrimStart('@').Replace("_003C", "").Replace("_003E", "").Replace("<", "").Replace(">", "").Replace("`", "_").Replace("-", "_").Replace(".", "_").Replace("|", "_").Replace("=", "_");
        if (n.Length == 0) n = "_";
        if (char.IsDigit(n[0])) n = "_" + n;
        return n;
    }

    // ---------------------------------------------------------------- type classification
    public bool IsIncluded(ITypeSymbol? t) => t is INamedTypeSymbol n && Included.Contains(n.OriginalDefinition);

    public static bool IsBcl(ITypeSymbol t)
    {
        if (t.SpecialType != SpecialType.None) return true;
        var ns = t.ContainingNamespace?.ToDisplayString() ?? "";
        return ns == "System" || ns.StartsWith("System.") || ns.StartsWith("Microsoft.") || ns == "Microsoft" || ns.StartsWith("JetBrains");
    }

    public static bool IsIntLike(ITypeSymbol? t)
    {
        if (t == null) return false;
        if (t is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nn) t = nn.TypeArguments[0];
        if (t.TypeKind == TypeKind.Enum) return true;
        return t.SpecialType is SpecialType.System_Int32 or SpecialType.System_Int64 or SpecialType.System_UInt32 or SpecialType.System_UInt64
            or SpecialType.System_Int16 or SpecialType.System_UInt16 or SpecialType.System_Byte or SpecialType.System_SByte or SpecialType.System_Char;
    }
    public static bool IsDecimal(ITypeSymbol? t)
    {
        if (t is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nn) t = nn.TypeArguments[0];
        return t?.SpecialType == SpecialType.System_Decimal;
    }
    public static bool IsFloat(ITypeSymbol? t)
    {
        if (t is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nn) t = nn.TypeArguments[0];
        return t?.SpecialType is SpecialType.System_Single or SpecialType.System_Double;
    }
    public static bool IsChar(ITypeSymbol? t) => t?.SpecialType == SpecialType.System_Char;
    public static bool IsString(ITypeSymbol? t) => t?.SpecialType == SpecialType.System_String;
    public static ITypeSymbol Unnull(ITypeSymbol t) => t is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } n ? n.TypeArguments[0] : t;

    public static string Full(ISymbol s) => s.OriginalDefinition.ToDisplayString(SymbolDisplayFormat.CSharpErrorMessageFormat);
    public static string TypeKey(INamedTypeSymbol t)
    {
        t = t.OriginalDefinition;
        var parts = new List<string>();
        for (INamedTypeSymbol? c = t; c != null; c = c.ContainingType) parts.Insert(0, c.Name + (c.Arity > 0 ? "`" + c.Arity : ""));
        var ns = t.ContainingNamespace?.IsGlobalNamespace == false ? t.ContainingNamespace.ToDisplayString() + "." : "";
        return ns + string.Join("+", parts);
    }

    /// List-like BCL types we represent as plain JS arrays.
    public static bool IsArrayLike(ITypeSymbol? t)
    {
        if (t == null) return false;
        if (t is IArrayTypeSymbol) return true;
        if (t is not INamedTypeSymbol n) return false;
        var k = TypeKey(n);
        return k is "System.Collections.Generic.List`1" or "System.Collections.Generic.IList`1" or "System.Collections.Generic.IReadOnlyList`1"
            or "System.Collections.ObjectModel.ReadOnlyCollection`1" or "System.Collections.Immutable.ImmutableArray`1" or "System.Span`1"
            or "System.ReadOnlySpan`1" or "System.Collections.Generic.ICollection`1" or "System.Collections.Generic.IReadOnlyCollection`1"
            || n.Name.Contains("ReadOnlyArray") || n.Name.Contains("ReadOnlyList") || n.Name.Contains("ReadOnlySingleElementList") || n.Name.Contains("InlineArray");
    }

    // ---------------------------------------------------------------- naming of types
    public void AssignTypeIds()
    {
        foreach (var g in Ordered.GroupBy(t => BaseName(t)))
        {
            var list = g.ToList();
            if (list.Count == 1 && !JsGlobals.Contains(g.Key) && !JsReserved.Contains(g.Key)) { Set(list[0], g.Key); continue; }
            for (int i = 1; ; i++)
            {
                var ids = list.Select(t => g.Key + "_" + string.Join("_", NsSegs(t).TakeLast(i))).ToList();
                if (ids.Distinct().Count() == ids.Count || i > 12)
                {
                    for (int k = 0; k < list.Count; k++)
                    {
                        var id = ids[k] + (list[k].Arity > 0 && i > 12 ? "$" + list[k].Arity : "");
                        while (usedIds.Contains(id)) id += "_";
                        Set(list[k], id);
                    }
                    break;
                }
            }
        }
        void Set(INamedTypeSymbol t, string id) { typeIds[t] = id; usedIds.Add(id); }
    }

    static string[] NsSegs(INamedTypeSymbol t) => (t.ContainingNamespace?.IsGlobalNamespace == false ? t.ContainingNamespace.ToDisplayString() : "global").Split('.');

    static string BaseName(INamedTypeSymbol t) => (t.ContainingType != null ? BaseName(t.ContainingType) + "_" : "") + CleanName(t.Name);

    public string TypeId(INamedTypeSymbol t) => typeIds.TryGetValue(t.OriginalDefinition, out var id) ? id : ExtAlias(t);

    public string ExtAlias(INamedTypeSymbol t)
    {
        t = t.OriginalDefinition;
        if (ExtAliases.TryGetValue(t, out var a)) return a;
        var b = BaseName(t) + "$";
        var id = b;
        if (usedIds.Contains(id))
        {
            var ns = (t.ContainingNamespace?.ToDisplayString() ?? "").Split('.').Reverse().ToList();
            int i = 0;
            do { id = BaseName(t) + "_" + string.Join("_", ns.Take(++i).Reverse()) + "$"; } while (usedIds.Contains(id) && i < ns.Count);
            while (usedIds.Contains(id)) id += "_";
        }
        usedIds.Add(id);
        ExtAliases[t] = id;
        if (!ExtUses.ContainsKey(t)) ExtUses[t] = new HashSet<ISymbol>(SE);
        // make sure base chain is known for stub inheritance
        for (var bt = t.BaseType; bt != null && !IsBcl(bt); bt = bt.BaseType) if (!IsIncluded(bt)) ExtAlias(bt);
        return id;
    }

    public void UseExt(ISymbol member)
    {
        var t = member.ContainingType?.OriginalDefinition;
        if (t == null || IsIncluded(t)) return;
        if (IsBcl(t))
        {
            var key = TypeKey(t) + "::" + member.Name;
            BclUses[key] = BclUses.GetValueOrDefault(key) + 1;
            return;
        }
        ExtAlias(t);
        ExtUses[t].Add(member.OriginalDefinition);
    }

    // ---------------------------------------------------------------- naming of members (overload mangling)
    readonly Dictionary<ISymbol, ISymbol> uf = new(SE);
    static ISymbol Root(ISymbol s)
    {
        s = s.OriginalDefinition;
        while (s is IMethodSymbol { OverriddenMethod: { } o }) s = o.OriginalDefinition;
        return s;
    }
    ISymbol Find(ISymbol s) { s = Root(s); while (uf.TryGetValue(s, out var p) && !SE.Equals(p, s)) s = Root(p); return s; }
    void Union(ISymbol a, ISymbol b) { var ra = Find(a); var rb = Find(b); if (!SE.Equals(ra, rb)) uf[ra] = rb; }

    readonly HashSet<ISymbol> overloaded = new(SE);

    public void ComputeMemberNames(IEnumerable<INamedTypeSymbol> types)
    {
        var all = types.Concat(ExtAliases.Keys.Where(t => !IsBcl(t))).Distinct<INamedTypeSymbol>(SE).ToList();
        foreach (var t in all)
            foreach (var m in t.GetMembers().OfType<IMethodSymbol>())
            {
                if (m.OverriddenMethod != null) Union(m, m.OverriddenMethod);
                foreach (var im in m.ExplicitInterfaceImplementations) Union(m, im);
            }
        foreach (var t in all.Where(t => t.TypeKind != TypeKind.Interface))
            foreach (var iface in t.AllInterfaces)
                foreach (var im in iface.GetMembers().OfType<IMethodSymbol>())
                    if (t.FindImplementationForInterfaceMember(im) is IMethodSymbol impl && SE.Equals(impl.ContainingType.OriginalDefinition, t.OriginalDefinition)) Union(impl, im);
        var sets = new List<List<ISymbol>>();
        foreach (var t in all)
        {
            var visible = new List<IMethodSymbol>();
            for (var c = t; c != null; c = c.BaseType) visible.AddRange(c.GetMembers().OfType<IMethodSymbol>().Where(IsNamedMethod));
            if (t.TypeKind == TypeKind.Interface) foreach (var i in t.AllInterfaces) visible.AddRange(i.GetMembers().OfType<IMethodSymbol>().Where(IsNamedMethod));
            foreach (var g in visible.GroupBy(m => m.Name))
            {
                var roots = g.Select(m => Find(m)).Distinct(SE).ToList();
                if (roots.Count > 1) { foreach (var r in roots) overloaded.Add(r); sets.Add(roots); }
            }
        }
        overloaded.RemoveWhere(r => IsBcl(r.ContainingType));
        // A root keeps its plain name when it is the only public member of every overload set it belongs to.
        var plain = new HashSet<ISymbol>(SE);
        var disqualified = new HashSet<ISymbol>(SE);
        foreach (var set in sets)
        {
            var pubs = set.Where(r => r.DeclaredAccessibility == Accessibility.Public && !IsBcl(r.ContainingType)).ToList();
            var bclNamed = set.Any(r => IsBcl(r.ContainingType));
            foreach (var r in set)
                if (pubs.Count == 1 && SE.Equals(pubs[0], r) && !bclNamed) plain.Add(r); else disqualified.Add(r);
        }
        plain.ExceptWith(disqualified);
        var byName = overloaded.OfType<IMethodSymbol>().GroupBy(m => m.Name);
        foreach (var g in byName)
        {
            var counts = g.GroupBy(m => m.Parameters.Length + m.TypeParameters.Length).ToDictionary(x => x.Key, x => x.Count());
            foreach (var m in g)
            {
                if (plain.Contains(m)) { memberNames[m] = BaseMember(m); continue; }
                var n = m.Parameters.Length + m.TypeParameters.Length;
                memberNames[m] = counts[n] == 1 ? $"{BaseMember(m)}${n}" : $"{BaseMember(m)}${string.Join("_", m.Parameters.Select(p => ShortType(p.Type)))}{(m.TypeParameters.Length > 0 ? "_T" + m.TypeParameters.Length : "")}";
            }
        }
    }

    static bool IsNamedMethod(IMethodSymbol m) => m.MethodKind is MethodKind.Ordinary or MethodKind.UserDefinedOperator or MethodKind.Conversion or MethodKind.ExplicitInterfaceImplementation;

    static string ShortType(ITypeSymbol t) => t switch
    {
        IArrayTypeSymbol a => ShortType(a.ElementType) + "Arr",
        INamedTypeSymbol { IsGenericType: true } n when n.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T => ShortType(n.TypeArguments[0]) + "N",
        INamedTypeSymbol { IsGenericType: true } n => CleanName(n.Name) + string.Concat(n.TypeArguments.Select(ShortType)),
        _ => CleanName(t.Name),
    };

    static string BaseMember(IMethodSymbol m)
    {
        var n = m.MethodKind == MethodKind.ExplicitInterfaceImplementation ? m.ExplicitInterfaceImplementations.FirstOrDefault()?.Name ?? m.Name : m.Name;
        return CleanName(n);
    }

    /// Same-class overloads that would collide in JS (e.g. Equals(object) + IEquatable<T>.Equals(T)): keeper keeps the name.
    public readonly Dictionary<IMethodSymbol, string> DupNames = new(SE);
    public void ComputeDupNames()
    {
        foreach (var t in Ordered)
        {
            var declared = t.GetMembers().OfType<IMethodSymbol>().Where(x => x.MethodKind is MethodKind.Ordinary or MethodKind.ExplicitInterfaceImplementation && !x.IsAbstract && !x.IsImplicitlyDeclared).ToList();
            foreach (var g in declared.GroupBy(x => (x.IsStatic, MethodName(x))).Where(g => g.Count() > 1))
            {
                var keeper = g.OrderBy(x => x.MethodKind == MethodKind.ExplicitInterfaceImplementation ? 1 : 0)
                              .ThenBy(x => x.Parameters.Count(p => p.Type.SpecialType != SpecialType.System_Object))
                              .ThenBy(x => x.Parameters.Length).First();
                int k = 0;
                foreach (var x in g) if (!SE.Equals(x, keeper)) DupNames[(IMethodSymbol)x.OriginalDefinition] = g.Key.Item2 + "$dup" + (++k);
            }
        }
    }

    public string MethodName(IMethodSymbol m)
    {
        m = (IMethodSymbol)m.OriginalDefinition;
        if (m.ReducedFrom != null) m = (IMethodSymbol)m.ReducedFrom.OriginalDefinition;
        if (DupNames.TryGetValue(m, out var dn)) return dn;
        var r = Find(m) as IMethodSymbol ?? m;
        if (memberNames.TryGetValue(r, out var n)) return n;
        return BaseMember(r);
    }

    public string MemberName(ISymbol s) => s switch
    {
        IMethodSymbol m => MethodName(m),
        IPropertySymbol { IsIndexer: true } => "Item",
        IPropertySymbol p when p.ExplicitInterfaceImplementations.Length > 0 => CleanName(p.ExplicitInterfaceImplementations[0].Name),
        IEventSymbol e when e.ExplicitInterfaceImplementations.Length > 0 => CleanName(e.ExplicitInterfaceImplementations[0].Name),
        _ => CleanName(s.Name),
    };

    public string CtorName(IMethodSymbol ctor)
    {
        var t = ctor.ContainingType.OriginalDefinition;
        var ctors = t.InstanceConstructors.Where(c => !(c.IsImplicitlyDeclared && t.IsRecord && c.Parameters.Length == 1)).Where(c => !c.IsImplicitlyDeclared || t.TypeKind == TypeKind.Struct || t.InstanceConstructors.Length == 1).ToList();
        var id = TypeId(t);
        if (ctors.Count <= 1) return "$ctor_" + id;
        var cnt = ctors.Count(c => c.Parameters.Length == ctor.Parameters.Length);
        return cnt == 1 ? $"$ctor_{id}${ctor.Parameters.Length}" : $"$ctor_{id}${string.Join("_", ctor.OriginalDefinition.Parameters.Select(p => ShortType(p.Type)))}";
    }

    // ---------------------------------------------------------------- TS type annotations (best effort; file is @ts-nocheck)
    public string Ts(ITypeSymbol? t)
    {
        if (t == null) return "any";
        switch (t)
        {
            case ITypeParameterSymbol tp: return CleanName(tp.Name);
            case IArrayTypeSymbol a: return Ts(a.ElementType) + "[]";
            case INamedTypeSymbol n:
                if (n.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T) return Ts(n.TypeArguments[0]) + " | null";
                if (n.IsTupleType) return "[" + string.Join(", ", n.TupleElements.Select(e => Ts(e.Type))) + "]";
                switch (n.SpecialType)
                {
                    case SpecialType.System_Boolean: return "boolean";
                    case SpecialType.System_String: return "string";
                    case SpecialType.System_Void: return "void";
                    case SpecialType.System_Object: return "any";
                    case SpecialType.System_Char: case SpecialType.System_Byte: case SpecialType.System_SByte: case SpecialType.System_Int16:
                    case SpecialType.System_UInt16: case SpecialType.System_Int32: case SpecialType.System_UInt32: case SpecialType.System_Int64:
                    case SpecialType.System_UInt64: case SpecialType.System_Single: case SpecialType.System_Double: case SpecialType.System_Decimal:
                        return "number";
                }
                if (n.TypeKind == TypeKind.Enum) return IsIncluded(n) ? TypeId(n) : "number";
                if (n.TypeKind == TypeKind.Delegate && n.DelegateInvokeMethod is { } inv)
                    return "((" + string.Join(", ", inv.Parameters.Select((p, i) => $"{SafeLocal(p.Name)}: {Ts(p.Type)}")) + ") => " + Ts(inv.ReturnType) + ")";
                var key = TypeKey(n);
                if (IsArrayLike(n)) return Ts(n.TypeArguments.FirstOrDefault()) + "[]";
                if (key is "System.Threading.Tasks.Task") return "$.Task<void>";
                if (key is "System.Threading.Tasks.Task`1") return $"$.Task<{Ts(n.TypeArguments[0])}>";
                if (key is "System.Collections.Generic.IEnumerable`1") return $"Iterable<{Ts(n.TypeArguments[0])}>";
                if (key.StartsWith("System.Collections.Generic.Dictionary`2") || key.StartsWith("System.Collections.Generic.IReadOnlyDictionary`2") || key.StartsWith("System.Collections.Generic.IDictionary`2"))
                    return $"$.Dictionary<{Ts(n.TypeArguments[0])}, {Ts(n.TypeArguments[1])}>";
                if (key is "System.Collections.Generic.HashSet`1" or "System.Collections.Generic.ISet`1" or "System.Collections.Generic.IReadOnlySet`1")
                    return $"$.HashSet<{Ts(n.TypeArguments[0])}>";
                if (IsIncluded(n))
                {
                    var id = TypeId(n);
                    return n.TypeArguments.Length > 0 && n.TypeArguments.All(a => a is not IErrorTypeSymbol) ? $"{id}<{string.Join(", ", n.TypeArguments.Select(Ts))}>" : id;
                }
                return "any";
        }
        return "any";
    }
}
