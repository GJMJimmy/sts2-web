using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

/// Emits TypeScript for transpiled types. Declarations live here; statements/expressions in the other partials.
public partial class Emitter
{
    readonly Ctx C;
    SemanticModel M = null!;
    INamedTypeSymbol CurType = null!;
    public Emitter(Ctx c) { C = c; }

    // Function context: hoisted declarations, temp counter, generator-ness
    sealed class Fn
    {
        public readonly List<string> Hoisted = new();
        public int Temp;
        public bool Gen;          // body runs inside function* (await => yield)
        public bool Static;
        public string? CatchVar;  // for `throw;`
        public bool Ctor;         // a constructor body: `return;` must still hand back `this`
    }
    readonly Stack<Fn> fns = new();
    static readonly Fn TopFn = new() { Static = true };
    Fn F => fns.Count > 0 ? fns.Peek() : TopFn;
    readonly Dictionary<ISymbol, string> symOverride = new(Ctx.SE);
    static int tempSeq;

    string Temp(string p = "$t") { var n = p + (++tempSeq); F.Hoisted.Add(n); return n; }
    void Hoist(string n) { if (!F.Hoisted.Contains(n)) F.Hoisted.Add(n); }

    SemanticModel ModelFor(SyntaxNode n) => C.Comp.GetSemanticModel(n.SyntaxTree);

    void Warn(SyntaxNode n, string msg)
    {
        var loc = n.GetLocation().GetLineSpan();
        C.Warnings.Add($"{Path.GetFileName(loc.Path)}:{loc.StartLinePosition.Line + 1}: {msg}: {Short(n)}");
    }
    static string Short(SyntaxNode n) { var s = n.ToString().Replace("\n", " "); return s.Length > 120 ? s[..120] : s; }

    string WithFn(Fn fn, Func<string> body)
    {
        fns.Push(fn);
        try
        {
            var b = body();
            return fn.Hoisted.Count > 0 ? $"let {string.Join(", ", fn.Hoisted)};\n{b}" : b;
        }
        finally { fns.Pop(); }
    }

    // ================================================================ types
    public string EmitType(INamedTypeSymbol t)
    {
        CurType = t;
        var decls = t.DeclaringSyntaxReferences.Select(r => r.GetSyntax()).ToList();
        M = ModelFor(decls[0]);
        try
        {
            return t.TypeKind switch
            {
                TypeKind.Enum => EmitEnum(t),
                TypeKind.Interface => EmitInterface(t),
                TypeKind.Delegate => "",
                _ => EmitClass(t, decls.OfType<TypeDeclarationSyntax>().ToList()),
            };
        }
        catch (Exception e)
        {
            C.Warnings.Add($"FATAL {t}: {e.Message} {e.StackTrace?.Split('\n').FirstOrDefault()}");
            return $"/* FAILED {t}: {e.Message.Replace("*/", "")} */\nexport class {C.TypeId(t)} {{}}\n";
        }
    }

    string EmitEnum(INamedTypeSymbol t)
    {
        var sb = new StringBuilder();
        var flags = t.GetAttributes().Any(a => a.AttributeClass?.Name == "FlagsAttribute");
        sb.Append($"export enum {C.TypeId(t)} {{");
        foreach (var f in t.GetMembers().OfType<IFieldSymbol>().Where(f => f.HasConstantValue))
            sb.Append($" {Ctx.CleanName(f.Name)} = {Convert.ToInt64(f.ConstantValue)},");
        sb.Append(" }\n");
        sb.Append($"$.enumMeta({C.TypeId(t)}, {Q(t.Name)}, {(flags ? "true" : "false")});\n");
        return sb.ToString();
    }

    string EmitInterface(INamedTypeSymbol t)
    {
        var id = C.TypeId(t);
        var bases = t.AllInterfaces.Select(IfaceRef).ToList();
        var sb = new StringBuilder();
        sb.Append($"export interface {id} {{ [k: string]: any }}\n");
        sb.Append($"export const {id} = $.iface({Q(t.Name)}, [{string.Join(", ", bases)}]);\n");
        // default interface methods / static members
        var decl = t.DeclaringSyntaxReferences.Select(r => r.GetSyntax()).OfType<InterfaceDeclarationSyntax>().First();
        var statics = decl.Members.Where(mm => mm.Modifiers.Any(SyntaxKind.StaticKeyword) && mm is not BaseTypeDeclarationSyntax).ToList();
        if (statics.Count > 0)
        {
            var sbody = new StringBuilder();
            var fi0 = new StringBuilder(); var z0 = new StringBuilder(); var fd0 = new List<string>();
            foreach (var mm in statics) { M = ModelFor(mm); EmitMember(mm, t, id, sbody, fi0, z0, fd0); }
            sb.Append($"$.ifaceStatics({id}, class {{\n{Indent(sbody.ToString())}}});\n");
        }
        var defaults = decl.Members.OfType<MethodDeclarationSyntax>().Where(m => (m.Body != null || m.ExpressionBody != null) && !m.Modifiers.Any(SyntaxKind.StaticKeyword)).ToList();
        var defaultProps = decl.Members.OfType<PropertyDeclarationSyntax>().Where(p => !p.Modifiers.Any(SyntaxKind.StaticKeyword)).Where(p => p.ExpressionBody != null || (p.AccessorList?.Accessors.Any(a => a.Body != null || a.ExpressionBody != null) ?? false)).ToList();
        if (defaults.Count + defaultProps.Count > 0)
        {
            var body = new StringBuilder();
            foreach (var m in defaults) body.Append(EmitMethod(m, (IMethodSymbol)M.GetDeclaredSymbol(m)!));
            foreach (var p in defaultProps) body.Append(EmitProperty(p, (IPropertySymbol)M.GetDeclaredSymbol(p)!, new StringBuilder()));
            sb.Append($"$.ifaceDefaults({id}, class {{\n{Indent(body.ToString())}}});\n");
        }
        return sb.ToString();
    }

    string IfaceRef(INamedTypeSymbol i) => C.IsIncluded(i) ? C.TypeId(i) : C.ExtAlias(i);

    public static string Indent(string s, int n = 1)
    {
        var pad = new string(' ', 2 * n);
        return string.Join("\n", s.TrimEnd('\n').Split('\n').Select(l => l.Length > 0 ? pad + l : l)) + "\n";
    }

    bool curHasCctor, curLazyInit;
    /// Guard before static member use / instance creation. beforefieldinit types only initialize on static field access.
    string CGuard(bool isStatic, bool isField = false) => curHasCctor && (isField || !curLazyInit) ? $"{C.TypeId(CurType)}.$ci();\n" : "";

    string EmitClass(INamedTypeSymbol t, List<TypeDeclarationSyntax> decls)
    {
        var id = C.TypeId(t);
        curHasCctor = t.StaticConstructors.Any(c => !c.IsImplicitlyDeclared);
        curLazyInit = C.BeforeFieldInit.Contains(Ctx.TypeKey(t));
        var sb = new StringBuilder();
        var body = new StringBuilder();
        var fi = new StringBuilder();      // instance field initializers
        var zero = new StringBuilder();    // struct zeroing
        var isStruct = t.TypeKind == TypeKind.Struct;
        string ext = "";
        var bt = t.BaseType;
        bool baseIncluded = bt != null && C.IsIncluded(bt);
        if (bt != null && bt.SpecialType is not (SpecialType.System_Object or SpecialType.System_ValueType or SpecialType.System_Enum))
            ext = " extends " + (baseIncluded ? C.TypeId(bt) : C.ExtAlias(bt));
        var tps = t.TypeParameters.Select(p => Ctx.CleanName(p.Name)).ToList();
        sb.Append($"export class {id}{(tps.Count > 0 ? "<" + string.Join(", ", tps) + ">" : "")}{ext} {{\n");
        body.Append($"static $name = {Q(t.Name)};\nstatic $fullName = {Q(Ctx.TypeKey(t))};\n");
        var ifaces = t.Interfaces.Select(IfaceRef).ToList();
        if (ifaces.Count > 0) body.Append($"static $ifaces = [{string.Join(", ", ifaces)}];\n");
        if (t.IsAbstract) body.Append("static $abstract = true;\n");
        if (isStruct) body.Append("static $struct = true;\n");
        if (t.IsRecord) body.Append("static $record = true;\n");

        var members = decls.SelectMany(d => d.Members).ToList();
        var fieldDecls = new List<string>();
        // C# 12 primary constructors: parameters are captured state visible to every member
        foreach (var d in decls.Where(d => d is not RecordDeclarationSyntax && d.ParameterList != null))
            foreach (var p in d.ParameterList!.Parameters)
                if (ModelFor(p).GetDeclaredSymbol(p) is IParameterSymbol ps) symOverride[ps] = "this.$p_" + Ctx.CleanName(ps.Name);


        foreach (var m in members)
        {
            M = ModelFor(m);
            try { EmitMember(m, t, id, body, fi, zero, fieldDecls); }
            catch (Exception e)
            {
                C.Warnings.Add($"FATAL member {t}.{Short(m)}: {e.Message} {e.StackTrace?.Split('\n').FirstOrDefault()}");
                body.Append($"/* FAILED member: {Short(m).Replace("*/", "")} */\n");
            }
        }
        // record primary constructor parameters → properties
        foreach (var d in decls.OfType<RecordDeclarationSyntax>().Where(r => r.ParameterList != null))
            foreach (var p in d.ParameterList!.Parameters)
            {
                var ps = t.GetMembers(p.Identifier.ValueText).OfType<IPropertySymbol>().FirstOrDefault();
                if (ps == null || !ps.IsImplicitlyDeclared && ps.DeclaringSyntaxReferences.Any(r => r.GetSyntax() is PropertyDeclarationSyntax)) continue;
                var n = Ctx.CleanName(ps.Name);
                body.Append($"get {n}() {{ return this.$_{n}; }}\nset {n}(v) {{ this.$_{n} = v; }}\n");
                fi.Append($"this.$_{n} = {DefaultOf(ps.Type)};\n");
            }

        // field declarations (types for consumers)
        foreach (var fd in fieldDecls) sb.Append("  " + fd + "\n");

        // field initializer / zero methods
        body.Append($"$fi_{id}() {{\n{Indent(CGuard(false) + fi.ToString())}  return this;\n}}\n");
        if (curHasCctor) body.Append($"static $ci() {{ if (!Object.hasOwn({id}, \"$cdone\")) {{ {id}.$cdone = true; {id}.$cctor(); }} }}\n");
        if (isStruct && t.IsRecord) body.Append($"$zero_{id}() {{\n{Indent(zero.ToString())}  return this;\n}}\nstatic $default() {{ return new {id}().$zero_{id}(); }}\n");
        else if (isStruct)
        {
            body.Append($"$zero_{id}() {{\n{Indent(zero.ToString())}  return this;\n}}\n");
            body.Append($"static $default() {{ return new {id}().$zero_{id}(); }}\n");
            var sfields = zero.ToString().Split('\n').Where(l => l.StartsWith("this.")).Select(l => l.Split(' ')[0]).ToList();
            if (!t.GetMembers("Equals").OfType<IMethodSymbol>().Any(x => !x.IsImplicitlyDeclared && x.Parameters.Length == 1))
                body.Append($"Equals(o) {{ return o instanceof {id}{string.Concat(sfields.Select(f => $" && $.equals({f}, o.{f.Substring(5)})"))}; }}\n");
            body.Append($"$key() {{ return $.keyOf([{string.Join(", ", sfields)}]); }}\n");
            body.Append($"$clone() {{ return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }}\n");
        }
        else if (!t.IsRecord && t.GetMembers("GetHashCode").OfType<IMethodSymbol>().Any(x => !x.IsImplicitlyDeclared && x.Parameters.Length == 0 && x.IsOverride))
            body.Append("$key() { return \"h\" + this.GetHashCode(); }\n");

        // constructors
        var ctors = t.InstanceConstructors.Where(c => !c.IsImplicitlyDeclared).ToList();
        if (!t.IsStatic)
        {
            foreach (var c in ctors)
            {
                var syn = c.DeclaringSyntaxReferences.Select(r => r.GetSyntax()).FirstOrDefault();
                M = ModelFor(syn ?? decls[0]);
                if (syn is ConstructorDeclarationSyntax cds) body.Append(EmitCtor(t, id, c, cds));
                else if (syn is RecordDeclarationSyntax rds) body.Append(EmitRecordPrimaryCtor(t, id, c, rds));
                else if (syn is ClassDeclarationSyntax or StructDeclarationSyntax) body.Append(EmitPrimaryCtor(t, id, c, (TypeDeclarationSyntax)syn!));
            }
            if (ctors.Count == 0 || (isStruct && !ctors.Any(c => c.Parameters.Length == 0)))
            {
                var implicitCtor = t.InstanceConstructors.FirstOrDefault(c => c.IsImplicitlyDeclared && c.Parameters.Length == 0);
                if (implicitCtor != null) body.Append(EmitImplicitCtor(t, id, implicitCtor));
            }
            var pctor = t.InstanceConstructors.FirstOrDefault(c => c.Parameters.All(p => p.IsOptional || p.IsParams));
            if (!t.IsAbstract && pctor != null && t.TypeParameters.Length == 0)
                body.Append($"static $new() {{ return new {id}().{C.CtorName(pctor)}({string.Join(", ", pctor.Parameters.Select(p => p.IsParams ? "[]" : DefaultParam(p)))}); }}\n");
        }

        if (t.IsRecord) body.Append(EmitRecordMembers(t, id));
        body.Append(EmitAttrMeta(t, id));

        sb.Append(Indent(body.ToString()));
        sb.Append("}\n");
        // iterable support
        if (t.AllInterfaces.Any(i => i.OriginalDefinition.SpecialType == SpecialType.System_Collections_Generic_IEnumerable_T || i.SpecialType == SpecialType.System_Collections_IEnumerable)
            && t.GetMembers("GetEnumerator").Any())
            sb.Append($"$.makeIterable({id});\n");
        return sb.ToString();
    }

    // ---------------------------------------------------------------- reflection metadata (attributes the game reads at runtime)
    bool KeepAttr(AttributeData a) =>
        a.AttributeClass != null && (C.IsIncluded(a.AttributeClass) || (a.AttributeClass.ContainingNamespace?.ToDisplayString() ?? "").StartsWith("System.Text.Json"));

    string AttrExpr(AttributeData a)
    {
        var ac = a.AttributeClass!;
        var args = a.ConstructorArguments.Select(TypedConst).ToList();
        var named = a.NamedArguments.Select(n => $"{Ctx.CleanName(n.Key)}: {TypedConst(n.Value)}").ToList();
        if (C.IsIncluded(ac) && a.AttributeConstructor != null)
        {
            var ctor = C.CtorName(a.AttributeConstructor);
            var full = a.AttributeConstructor.Parameters.Select((p, i) => i < args.Count ? args[i] : DefaultParam(p));
            var created = $"new {C.TypeId(ac)}().{ctor}({string.Join(", ", full)})";
            return named.Count > 0 ? $"Object.assign({created}, {{ {string.Join(", ", named)} }})" : created;
        }
        return $"$.extAttr({C.ExtAlias(ac)}, [{string.Join(", ", args)}], {{ {string.Join(", ", named)} }})";
    }

    string TypedConst(TypedConstant c) => c.Kind switch
    {
        TypedConstantKind.Array => "[" + string.Join(", ", c.Values.Select(TypedConst)) + "]",
        TypedConstantKind.Type => c.Value is ITypeSymbol ts ? TypeRef(ts) : "null",
        _ => ConstLit(c.Value, c.Type),
    };

    /// A member's type for reflection metadata: arrays and lists keep their element type (PropertyType.GetElementType()).
    string MetaTypeRef(ITypeSymbol t) => t switch
    {
        IArrayTypeSymbol a => $"$.arrayOf({TypeRef(a.ElementType)})",
        INamedTypeSymbol n when Ctx.IsArrayLike(n) && n.TypeArguments.Length == 1 => $"$.arrayOf({TypeRef(n.TypeArguments[0])})",
        _ => TypeRef(t),
    };

    string EmitAttrMeta(INamedTypeSymbol t, string id)
    {
        var sb = new StringBuilder();
        var tattrs = t.GetAttributes().Where(KeepAttr).ToList();
        if (tattrs.Count > 0) sb.Append($"static get $attrs() {{ return Object.hasOwn({id}, \"$a\") ? {id}.$a : ({id}.$a = [{string.Join(", ", tattrs.Select(AttrExpr))}]); }}\n");
        var members = new List<string>();
        foreach (var mem in t.GetMembers())
        {
            if (mem.IsImplicitlyDeclared || mem.IsStatic) continue;
            var attrs = mem.GetAttributes().Where(KeepAttr).ToList();
            if (mem is IPropertySymbol ps && ps.IsIndexer) continue;
            if (attrs.Count == 0 || mem is not (IPropertySymbol or IFieldSymbol)) continue;
            var mt = mem is IPropertySymbol pp ? pp.Type : ((IFieldSymbol)mem).Type;
            members.Add($"{C.MemberName(mem)}: {{ t: {MetaTypeRef(mt)}, k: \"{(mem is IPropertySymbol ? "p" : "f")}\", a: [{string.Join(", ", attrs.Select(AttrExpr))}] }}");
        }
        if (members.Count > 0) sb.Append($"static $members() {{ return Object.hasOwn({id}, \"$m\") ? {id}.$m : ({id}.$m = {{ {string.Join(", ", members)} }}); }}\n");
        return sb.ToString();
    }

    string DefaultParam(IParameterSymbol p) => p.HasExplicitDefaultValue ? ConstLit(p.ExplicitDefaultValue, p.Type) : DefaultOf(p.Type);

    void EmitMember(MemberDeclarationSyntax m, INamedTypeSymbol t, string id, StringBuilder body, StringBuilder fi, StringBuilder zero, List<string> fieldDecls)
    {
        switch (m)
        {
            case FieldDeclarationSyntax fd:
                foreach (var v in fd.Declaration.Variables)
                {
                    var f = (IFieldSymbol)M.GetDeclaredSymbol(v)!;
                    var n = Ctx.CleanName(f.Name);
                    if (f.IsConst)
                    {
                        body.Append($"static readonly {n} = {ConstLit(f.ConstantValue, f.Type)};\n");
                        continue;
                    }
                    if (f.IsStatic)
                    {
                        if (v.Initializer == null && !curHasCctor) body.Append($"static {n} = {DefaultOf(f.Type)};\n");
                        else if (v.Initializer == null) body.Append($"static get {n}() {{ {CGuard(true, true)}return Object.hasOwn({id}, \"$s_{n}\") ? {id}.$s_{n} : {DefaultOf(f.Type)}; }}\nstatic set {n}(v) {{ {id}.$s_{n} = v; }}\n");
                        else body.Append(LazyStatic(id, n, v.Initializer.Value, f.Type));
                        continue;
                    }
                    fieldDecls.Add($"declare {n}: {C.Ts(f.Type)};");
                    var init = v.Initializer != null ? InitExpr(v.Initializer.Value, f.Type, false) : DefaultOf(f.Type);
                    fi.Append($"this.{n} = {init};\n");
                    zero.Append($"this.{n} = {DefaultOf(f.Type)};\n");
                }
                break;
            case EventFieldDeclarationSyntax ed:
                foreach (var v in ed.Declaration.Variables)
                {
                    var e = (IEventSymbol)M.GetDeclaredSymbol(v)!;
                    var n = C.MemberName(e);
                    if (e.IsStatic) body.Append($"static {n} = null;\n");
                    else { fieldDecls.Add($"declare {n}: any;"); fi.Append($"this.{n} = {(v.Initializer != null ? Expr(v.Initializer.Value) : "null")};\n"); }
                }
                break;
            case PropertyDeclarationSyntax pd:
                body.Append(EmitProperty(pd, (IPropertySymbol)M.GetDeclaredSymbol(pd)!, fi, zero));
                break;
            case IndexerDeclarationSyntax ixd:
                body.Append(EmitIndexer(ixd, (IPropertySymbol)M.GetDeclaredSymbol(ixd)!));
                break;
            case MethodDeclarationSyntax md:
                body.Append(EmitMethod(md, (IMethodSymbol)M.GetDeclaredSymbol(md)!));
                break;
            case OperatorDeclarationSyntax od:
                body.Append(EmitMethodLike((IMethodSymbol)M.GetDeclaredSymbol(od)!, od.ParameterList, od.Body, od.ExpressionBody, od));
                break;
            case ConversionOperatorDeclarationSyntax cd:
                body.Append(EmitMethodLike((IMethodSymbol)M.GetDeclaredSymbol(cd)!, cd.ParameterList, cd.Body, cd.ExpressionBody, cd));
                break;
            case ConstructorDeclarationSyntax cds when cds.Modifiers.Any(SyntaxKind.StaticKeyword):
                body.Append($"static $cctor() {{\n{Indent(FnBody(cds.Body, cds.ExpressionBody, isStatic: true, gen: false))}}}\n");
                C.Warnings.Add($"static ctor in {t}");
                StaticCtors.Add(id);
                break;
            case EventDeclarationSyntax evd when evd.AccessorList != null:
            {
                // an event with its own add / remove: `x.E += h` calls x.$add_E(h) (EmitExpr compound assignment)
                var e = (IEventSymbol)M.GetDeclaredSymbol(evd)!;
                var n = C.MemberName(e);
                var st = e.IsStatic ? "static " : "";
                foreach (var a in evd.AccessorList.Accessors)
                {
                    if (a.Body == null && a.ExpressionBody == null) continue;
                    var acc = a.IsKind(SyntaxKind.AddAccessorDeclaration) ? e.AddMethod : e.RemoveMethod;
                    if (acc == null) continue;
                    symOverride[acc.Parameters[0]] = "value";
                    var kind = a.IsKind(SyntaxKind.AddAccessorDeclaration) ? "add" : "remove";
                    body.Append($"{st}${kind}_{n}(value) {{\n{Indent(FnBody(a.Body, a.ExpressionBody, e.IsStatic, gen: false))}}}\n");
                }
                break;
            }
            case ConstructorDeclarationSyntax: case DestructorDeclarationSyntax: case BaseTypeDeclarationSyntax: case DelegateDeclarationSyntax: case EventDeclarationSyntax:
                break;
            default:
                Warn(m, "unhandled member " + m.Kind());
                break;
        }
    }

    public readonly List<string> StaticCtors = new();

    /// Field/property initializer expression in its own function context; hoisted temps force an IIFE.
    string InitExpr(ExpressionSyntax init, ITypeSymbol? type, bool isStatic)
    {
        var fn = new Fn { Static = isStatic };
        var v = WithFn(fn, () => ExprIn(init, type));
        if (fn.Hoisted.Count == 0) return v;
        var parts = v.Split('\n', 2);
        return $"(() => {{ {parts[0]} return {parts[1]}; }})()";
    }

    string LazyStatic(string id, string n, ExpressionSyntax init, ITypeSymbol type)
    {
        var v = InitExpr(init, type, true);
        return $"static get {n}() {{ {CGuard(true, true)}return Object.hasOwn({id}, \"$s_{n}\") ? {id}.$s_{n} : ({id}.$s_{n} = {v}); }}\nstatic set {n}(v) {{ {id}.$s_{n} = v; }}\n";
    }

    // ---------------------------------------------------------------- properties
    string EmitProperty(PropertyDeclarationSyntax pd, IPropertySymbol p, StringBuilder fi, StringBuilder? zero = null)
    {
        if (p.IsAbstract) return "";
        var sb = new StringBuilder();
        var n = C.MemberName(p);
        var st = p.IsStatic ? "static " : "";
        var id = C.TypeId(p.ContainingType);
        var tgt = p.IsStatic ? id : "this";
        bool isAuto = pd.ExpressionBody == null && pd.AccessorList != null && pd.AccessorList.Accessors.All(a => a.Body == null && a.ExpressionBody == null)
                      && !pd.Modifiers.Any(SyntaxKind.ExternKeyword) && p.ContainingType.TypeKind != TypeKind.Interface;
        if (isAuto)
        {
            if (p.IsStatic)
            {
                if (pd.Initializer != null)
                {
                    var v = InitExpr(pd.Initializer.Value, p.Type, true);
                    sb.Append($"static get {n}() {{ {CGuard(true, true)}return Object.hasOwn({id}, \"$s_{n}\") ? {id}.$s_{n} : ({id}.$s_{n} = {v}); }}\n");
                }
                else sb.Append($"static get {n}() {{ {CGuard(true, true)}return Object.hasOwn({id}, \"$s_{n}\") ? {id}.$s_{n} : {DefaultOf(p.Type)}; }}\n");
                sb.Append($"static set {n}(v) {{ {id}.$s_{n} = v; }}\n");
            }
            else
            {
                sb.Append($"get {n}() {{ return this.$_{n}; }}\nset {n}(v) {{ this.$_{n} = v; }}\n");
                fi.Append($"this.$_{n} = {(pd.Initializer != null ? InitExpr(pd.Initializer.Value, p.Type, false) : DefaultOf(p.Type))};\n");
                zero?.Append($"this.$_{n} = {DefaultOf(p.Type)};\n");
            }
            return sb.ToString();
        }
        if (pd.ExpressionBody != null)
        {
            sb.Append($"{st}get {n}() {{\n{Indent((p.IsStatic ? CGuard(true) : "") + FnBodyExpr(pd.ExpressionBody.Expression, p.IsStatic, gen: false, p.Type))}}}\n");
            if (p.OverriddenProperty?.SetMethod != null) sb.Append($"{st}set {n}(v) {{ $.superSet({BaseProto(p)}, \"{n}\", this, v); }}\n");
            return sb.ToString();
        }
        bool hasGet = false, hasSet = false;
        foreach (var a in pd.AccessorList!.Accessors)
        {
            if (a.Body == null && a.ExpressionBody == null) continue; // abstract accessor
            if (a.IsKind(SyntaxKind.GetAccessorDeclaration))
            {
                hasGet = true;
                sb.Append($"{st}get {n}() {{\n{Indent((p.IsStatic ? CGuard(true) : "") + FnBody(a.Body, a.ExpressionBody, p.IsStatic, gen: IsIterator(a), retType: p.Type))}}}\n");
            }
            else
            {
                hasSet = true;
                var vs = p.SetMethod!.Parameters[0];
                symOverride[vs] = "value";
                sb.Append($"{st}set {n}(value) {{\n{Indent(FnBody(a.Body, a.ExpressionBody, p.IsStatic, gen: false))}}}\n");
            }
        }
        if (!p.IsStatic && p.OverriddenProperty != null)
        {
            if (!hasGet && p.OverriddenProperty.GetMethod != null) sb.Append($"get {n}() {{ return $.superGet({BaseProto(p)}, \"{n}\", this); }}\n");
            if (!hasSet && p.OverriddenProperty.SetMethod != null) sb.Append($"set {n}(v) {{ $.superSet({BaseProto(p)}, \"{n}\", this, v); }}\n");
        }
        return sb.ToString();
    }

    string BaseProto(ISymbol member)
    {
        var bt = member.ContainingType.BaseType!;
        return (C.IsIncluded(bt) ? C.TypeId(bt) : C.ExtAlias(bt)) + ".prototype";
    }

    string EmitIndexer(IndexerDeclarationSyntax ixd, IPropertySymbol p)
    {
        if (p.IsAbstract) return "";
        var sb = new StringBuilder();
        var getName = p.GetMethod != null ? C.MethodName(p.GetMethod) : "get_Item";
        var setName = p.SetMethod != null ? C.MethodName(p.SetMethod) : "set_Item";
        var ps = string.Join(", ", p.Parameters.Select(x => Ctx.SafeLocal(x.Name)));
        if (ixd.ExpressionBody != null)
            return $"{getName}({ps}) {{\n{Indent(FnBodyExpr(ixd.ExpressionBody.Expression, false, false, p.Type))}}}\n";
        foreach (var a in ixd.AccessorList!.Accessors)
        {
            if (a.Body == null && a.ExpressionBody == null) continue;
            if (a.IsKind(SyntaxKind.GetAccessorDeclaration))
                sb.Append($"{getName}({ps}) {{\n{Indent(FnBody(a.Body, a.ExpressionBody, false, false, retType: p.Type))}}}\n");
            else
            {
                symOverride[p.SetMethod!.Parameters.Last()] = "value";
                sb.Append($"{setName}({ps}, value) {{\n{Indent(FnBody(a.Body, a.ExpressionBody, false, false))}  return value;\n}}\n");
            }
        }
        return sb.ToString();
    }

    // ---------------------------------------------------------------- methods
    static bool IsIterator(SyntaxNode body) =>
        body.DescendantNodes(n => n is not (LambdaExpressionSyntax or AnonymousMethodExpressionSyntax or LocalFunctionStatementSyntax)).Any(n => n is YieldStatementSyntax);

    string EmitMethod(MethodDeclarationSyntax md, IMethodSymbol m)
    {
        var grx = m.GetAttributes().FirstOrDefault(a => a.AttributeClass?.Name == "GeneratedRegexAttribute")
                  ?? m.PartialDefinitionPart?.GetAttributes().FirstOrDefault(a => a.AttributeClass?.Name == "GeneratedRegexAttribute");
        if (grx != null)
        {
            if (m.PartialDefinitionPart != null && md.Body == null && md.ExpressionBody == null) return "";
            return $"{(m.IsStatic ? "static " : "")}{C.MethodName(m)}() {{ return $.regex({Q((string)grx.ConstructorArguments[0].Value!)}, {(grx.ConstructorArguments.Length > 1 ? Convert.ToInt32(grx.ConstructorArguments[1].Value) : 0)}); }}\n";
        }
        if (m.IsAbstract || (md.Body == null && md.ExpressionBody == null))
        {
            if (m.IsPartialDefinition && m.PartialImplementationPart == null)
            {
                var rx = m.GetAttributes().FirstOrDefault(a => a.AttributeClass?.Name == "GeneratedRegexAttribute");
                if (rx != null)
                    return $"{(m.IsStatic ? "static " : "")}{C.MethodName(m)}() {{ return $.regex({Q((string)rx.ConstructorArguments[0].Value!)}, {(rx.ConstructorArguments.Length > 1 ? Convert.ToInt32(rx.ConstructorArguments[1].Value) : 0)}); }}\n";
            }
            return "";
        }
        return EmitMethodLike(m, md.ParameterList, md.Body, md.ExpressionBody, md);
    }

    readonly Dictionary<IMethodSymbol, string> dupRenames = new(SymbolEqualityComparer.Default);

    string EmitMethodLike(IMethodSymbol m, ParameterListSyntax pl, BlockSyntax? body, ArrowExpressionClauseSyntax? eb, SyntaxNode node)
    {
        var name = C.MethodName(m);
        var st = m.IsStatic ? "static " : "";
        var ps = Params(m.Parameters, m.TypeParameters);
        var isAsync = m.IsAsync;
        var isIter = IsIterator((SyntaxNode?)body ?? eb!);
        var ret = C.Ts(m.ReturnType);
        string inner;
        if (isAsync) inner = $"return $.async(function* () {{\n{Indent(FnBody(body, eb, m.IsStatic, gen: true, retType: AsyncResultType(m.ReturnType), isVoid: IsVoidAsync(m.ReturnType)))}}}, this);";
        else if (isIter) inner = $"return $.seq(function* () {{\n{Indent(FnBody(body, eb, m.IsStatic, gen: true, iter: true))}}}, this);";
        else inner = FnBody(body, eb, m.IsStatic, gen: false, retType: m.ReturnType, isVoid: m.ReturnsVoid);
        if (m.IsStatic && curHasCctor && m.MethodKind != MethodKind.StaticConstructor) inner = CGuard(true) + inner;
        return $"{st}{name}({ps}): {ret} {{\n{Indent(inner)}}}\n";
    }

    static bool IsVoidAsync(ITypeSymbol t) => t is INamedTypeSymbol { IsGenericType: false } || t.SpecialType == SpecialType.System_Void;
    static ITypeSymbol? AsyncResultType(ITypeSymbol t) => t is INamedTypeSymbol { IsGenericType: true } n ? n.TypeArguments[0] : null;

    string Params(IEnumerable<IParameterSymbol> ps, IEnumerable<ITypeParameterSymbol>? tps = null)
    {
        var list = new List<string>();
        if (tps != null) list.AddRange(tps.Select(RtTypeParam));
        foreach (var p in ps)
        {
            var n = Ctx.SafeLocal(p.Name);
            if (p.RefKind is RefKind.Out or RefKind.Ref) symOverride[p] = n + ".v";
            var def = p.HasExplicitDefaultValue ? " = " + ConstLit(p.ExplicitDefaultValue, p.Type) : "";
            list.Add(n + def);
        }
        return string.Join(", ", list);
    }

    static string RtTypeParam(ITypeParameterSymbol tp) => "$T_" + Ctx.CleanName(tp.Name);

    /// Emits a function body (block or expression) inside a fresh function context.
    string FnBody(BlockSyntax? body, ArrowExpressionClauseSyntax? eb, bool isStatic, bool gen, bool iter = false, ITypeSymbol? retType = null, bool isVoid = false)
    {
        if (body == null && eb != null) return FnBodyExpr(eb.Expression, isStatic, gen, retType, isVoid);
        var fn = new Fn { Gen = gen, Static = isStatic };
        return WithFn(fn, () => StmtListText(body!.Statements));
    }

    string FnBodyExpr(ExpressionSyntax e, bool isStatic, bool gen, ITypeSymbol? retType, bool isVoid = false)
    {
        var fn = new Fn { Gen = gen, Static = isStatic };
        return WithFn(fn, () =>
        {
            var v = ExprIn(e, retType);
            return isVoid || retType?.SpecialType == SpecialType.System_Void ? v + ";\n" : "return " + v + ";\n";
        });
    }

    // ---------------------------------------------------------------- constructors
    string EmitCtor(INamedTypeSymbol t, string id, IMethodSymbol c, ConstructorDeclarationSyntax cds)
    {
        var name = C.CtorName(c);
        var ps = Params(c.Parameters, null);
        var tparams = t.TypeParameters.Select(RtTypeParam).ToList();
        var all = string.Join(", ", tparams.Concat(ps.Length > 0 ? new[] { ps } : Array.Empty<string>()));
        var fn = new Fn { Gen = false, Ctor = true };
        var text = WithFn(fn, () =>
        {
            var sb = new StringBuilder();
            foreach (var tp in t.TypeParameters) sb.Append($"this.$T_{Ctx.CleanName(tp.Name)} = {RtTypeParam(tp)};\n");
            var init = cds.Initializer;
            if (init != null && init.ThisOrBaseKeyword.IsKind(SyntaxKind.ThisKeyword))
            {
                var op = M.GetOperation(init) as Microsoft.CodeAnalysis.Operations.IInvocationOperation;
                var target = op?.TargetMethod ?? (IMethodSymbol)M.GetSymbolInfo(init).Symbol!;
                sb.Append($"this.{C.CtorName(target)}({string.Join(", ", t.TypeParameters.Select(RtTypeParam).Concat(op != null ? ArgList(op.Arguments, target) : new List<string>()))});\n");
            }
            else
            {
                sb.Append($"this.$fi_{id}();\n");
                if (!(cds.Body?.ToString().Contains("base._002Ector") ?? false)) sb.Append(BaseCtorCall(t, init));
            }
            if (cds.Body != null) sb.Append(StmtListText(cds.Body.Statements));
            else if (cds.ExpressionBody != null) sb.Append(ExprIn(cds.ExpressionBody.Expression, null) + ";\n");
            return sb.ToString();
        });
        return $"{name}({all}) {{\n{Indent(text)}  return this;\n}}\n";
    }

    string BaseCtorCall(INamedTypeSymbol t, ConstructorInitializerSyntax? init)
    {
        var bt = t.BaseType;
        if (bt == null || bt.SpecialType is SpecialType.System_Object or SpecialType.System_ValueType) return "";
        IMethodSymbol? target; List<string> args;
        if (init != null)
        {
            var op = M.GetOperation(init) as Microsoft.CodeAnalysis.Operations.IInvocationOperation;
            target = op?.TargetMethod ?? M.GetSymbolInfo(init).Symbol as IMethodSymbol;
            args = op != null && target != null ? ArgList(op.Arguments, target) : new List<string>();
        }
        else
        {
            target = bt.InstanceConstructors.FirstOrDefault(c => c.Parameters.All(p => p.IsOptional));
            args = target?.Parameters.Select(DefaultParam).ToList() ?? new List<string>();
        }
        if (target == null) return "";
        if (C.IsIncluded(bt))
        {
            var targs = bt.TypeArguments.Select(a => TypeRef(a)).ToList();
            return $"this.{C.CtorName(target)}({string.Join(", ", targs.Concat(args))});\n";
        }
        C.UseExt(target);
        return args.Count > 0 ? $"$.extBase(this, {C.ExtAlias(bt)}, [{string.Join(", ", args)}]);\n" : "";
    }

    string EmitImplicitCtor(INamedTypeSymbol t, string id, IMethodSymbol c)
    {
        var tparams = t.TypeParameters.Select(RtTypeParam).ToList();
        var sb = new StringBuilder();
        foreach (var tp in t.TypeParameters) sb.Append($"this.$T_{Ctx.CleanName(tp.Name)} = {RtTypeParam(tp)};\n");
        if (t.TypeKind == TypeKind.Struct) sb.Append($"this.$zero_{id}();\n");
        sb.Append($"this.$fi_{id}();\n");
        sb.Append(BaseCtorCall(t, null));
        return $"{C.CtorName(c)}({string.Join(", ", tparams)}) {{\n{Indent(sb.ToString())}  return this;\n}}\n";
    }

    string EmitRecordPrimaryCtor(INamedTypeSymbol t, string id, IMethodSymbol c, RecordDeclarationSyntax rds)
    {
        if (c.Parameters.Length == 1 && SymbolEqualityComparer.Default.Equals(c.Parameters[0].Type, t)) return ""; // copy ctor
        var ps = Params(c.Parameters);
        var sb = new StringBuilder($"this.$fi_{id}();\n");
        foreach (var p in c.Parameters) sb.Append($"this.$_{Ctx.CleanName(p.Name)} = {Ctx.SafeLocal(p.Name)};\n");
        return $"{C.CtorName(c)}({ps}) {{\n{Indent(sb.ToString())}  return this;\n}}\n";
    }

    string EmitPrimaryCtor(INamedTypeSymbol t, string id, IMethodSymbol c, TypeDeclarationSyntax tds)
    {
        var ps = Params(c.Parameters);
        foreach (var p in c.Parameters) symOverride[p] = "this.$p_" + Ctx.CleanName(p.Name);
        var sb = new StringBuilder();
        foreach (var p in c.Parameters) sb.Append($"this.$p_{Ctx.CleanName(p.Name)} = {Ctx.SafeLocal(p.Name)};\n");
        sb.Append($"this.$fi_{id}();\n");
        return $"{C.CtorName(c)}({ps}) {{\n{Indent(sb.ToString())}  return this;\n}}\n";
    }

    string EmitRecordMembers(INamedTypeSymbol t, string id)
    {
        var fields = new List<string>();
        for (var c = t; c != null && C.IsIncluded(c); c = c.BaseType)
            foreach (var m in c.GetMembers())
            {
                if (m.IsStatic) continue;
                if (m is IFieldSymbol f && !f.IsImplicitlyDeclared) fields.Add(Ctx.CleanName(f.Name));
                else if (m is IPropertySymbol p && !p.IsIndexer && p.GetMethod != null && IsAutoProp(p)) fields.Add("$_" + Ctx.CleanName(p.Name));
            }
        fields = fields.Distinct().ToList();
        var sb = new StringBuilder();
        var userEquals = t.GetMembers("Equals").OfType<IMethodSymbol>().Any(m => !m.IsImplicitlyDeclared && m.Parameters.Length == 1);
        if (!userEquals)
            sb.Append($"Equals(o) {{ return o != null && o.constructor === this.constructor{string.Concat(fields.Select(f => $" && $.equals(this.{f}, o.{f})"))}; }}\n");
        if (!t.GetMembers("GetHashCode").OfType<IMethodSymbol>().Any(m => !m.IsImplicitlyDeclared))
            sb.Append($"GetHashCode() {{ return $.hashCombine({string.Join(", ", fields.Select(f => "this." + f))}); }}\n");
        sb.Append($"static op_Equality(a, b) {{ return a == null ? b == null : a.Equals(b); }}\n");
        sb.Append($"static op_Inequality(a, b) {{ return !{id}.op_Equality(a, b); }}\n");
        sb.Append($"$clone() {{ return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }}\n");
        sb.Append($"$key() {{ return $.keyOf([{string.Join(", ", fields.Select(f => "this." + f))}]); }}\n");
        if (!t.GetMembers("ToString").OfType<IMethodSymbol>().Any(m => !m.IsImplicitlyDeclared))
        {
            var props = t.GetMembers().OfType<IPropertySymbol>().Where(p => !p.IsStatic && !p.IsIndexer && p.DeclaredAccessibility == Accessibility.Public && p.Name != "EqualityContract").Select(p => Ctx.CleanName(p.Name));
            sb.Append($"ToString() {{ return {Q(t.Name + " { ")} + [{string.Join(", ", props.Select(p => $"\"{p} = \" + $.str(this.{p})"))}].join(\", \") + \" }}\"; }}\n");
        }
        return sb.ToString();
    }

    bool IsAutoProp(IPropertySymbol p) =>
        p.DeclaringSyntaxReferences.Select(r => r.GetSyntax()).Any(s => s is PropertyDeclarationSyntax pd && pd.ExpressionBody == null && pd.AccessorList != null && pd.AccessorList.Accessors.All(a => a.Body == null && a.ExpressionBody == null))
        || p.DeclaringSyntaxReferences.Any(r => r.GetSyntax() is ParameterSyntax);

    // ---------------------------------------------------------------- literals & defaults
    public static string Q(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (var ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20 || ch == (char)0x2028 || ch == (char)0x2029) sb.Append($"\\u{(int)ch:x4}"); else sb.Append(ch);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    public string ConstLit(object? v, ITypeSymbol? t)
    {
        if (v == null)
            return t != null && t.IsValueType && Ctx.Unnull(t) is var u && !SymbolEqualityComparer.Default.Equals(u, t) ? "null" : (t != null && t.IsValueType && t.OriginalDefinition.SpecialType != SpecialType.System_Nullable_T ? DefaultOf(t) : "null");
        switch (v)
        {
            case string s: return Q(s);
            case bool b: return b ? "true" : "false";
            case char c: return ((int)c).ToString();
            case float f: return FmtNum(f);
            case double d: return FmtNum(d);
            case decimal m: return m.ToString(System.Globalization.CultureInfo.InvariantCulture);
            default:
                var num = Convert.ToDecimal(v, System.Globalization.CultureInfo.InvariantCulture).ToString(System.Globalization.CultureInfo.InvariantCulture);
                if (t is INamedTypeSymbol { TypeKind: TypeKind.Enum } et && C.IsIncluded(et))
                {
                    var f = et.GetMembers().OfType<IFieldSymbol>().FirstOrDefault(x => x.HasConstantValue && Equals(Convert.ToInt64(x.ConstantValue), Convert.ToInt64(v)));
                    if (f != null) return $"{C.TypeId(et)}.{Ctx.CleanName(f.Name)}";
                }
                return num;
        }
    }

    static string FmtNum(double d)
    {
        if (double.IsPositiveInfinity(d)) return "Infinity";
        if (double.IsNegativeInfinity(d)) return "-Infinity";
        if (double.IsNaN(d)) return "NaN";
        return d.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
    }

    public string DefaultOf(ITypeSymbol? t)
    {
        if (t == null) return "null";
        if (t is ITypeParameterSymbol tp) return $"$.defaultOf({TypeRef(tp)})";
        if (t.Name.Contains("InlineArray")) return "[]";
        if (!t.IsValueType) return "null";
        if (t.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T) return "null";
        if (t.SpecialType == SpecialType.System_Boolean) return "false";
        if (t.TypeKind == TypeKind.Enum || Ctx.IsIntLike(t) || Ctx.IsFloat(t) || Ctx.IsDecimal(t)) return "0";
        if (t is INamedTypeSymbol n)
        {
            if (n.IsTupleType) return "[" + string.Join(", ", n.TupleElements.Select(e => DefaultOf(e.Type))) + "]";
            if (C.IsIncluded(n)) return $"new {C.TypeId(n)}().$zero_{C.TypeId(n)}()";
            return $"$.defaultOf({TypeRef(n)})";
        }
        return "null";
    }
}
