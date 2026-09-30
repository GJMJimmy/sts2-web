using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

public partial class Emitter
{
    const string CondPh = "\u0001";
    readonly Stack<string> condRecv = new();

    string ExprIn(ExpressionSyntax e, ITypeSymbol? target) => Expr(e);

    string Expr(ExpressionSyntax e)
    {
        var s = ExprCore(e);
        if (e is not (LambdaExpressionSyntax or AnonymousMethodExpressionSyntax))
        {
            Conversion conv;
            try { conv = M.GetConversion(e); } catch { return s; }
            if (conv.IsUserDefined && conv.MethodSymbol is { } cm && conv.IsImplicit)
            {
                if (C.IsIncluded(cm.ContainingType)) s = $"{C.TypeId(cm.ContainingType)}.{C.MethodName(cm)}({s})";
                else C.UseExt(cm);
            }
        }
        return s;
    }

    ISymbol? Sym(SyntaxNode n)
    {
        var si = M.GetSymbolInfo(n);
        return si.Symbol ?? si.CandidateSymbols.FirstOrDefault();
    }

    string ExprCore(ExpressionSyntax e)
    {
        switch (e)
        {
            case LiteralExpressionSyntax l: return Literal(l);
            case IdentifierNameSyntax or GenericNameSyntax: return Name((SimpleNameSyntax)e);
            case QualifiedNameSyntax or AliasQualifiedNameSyntax:
                {
                    var s = Sym(e);
                    if (s is ITypeSymbol ts) return TypeRef(ts);
                    if (s is INamespaceSymbol) return "";
                    return e is QualifiedNameSyntax q ? MemberOn(ExprCore(q.Left), s!, M.GetTypeInfo(q.Left).Type, e, isStaticRecv: Sym(q.Left) is ITypeSymbol) : Name(((AliasQualifiedNameSyntax)e).Name);
                }
            case PredefinedTypeSyntax p: return TypeRef(M.GetTypeInfo(p).Type!);
            case NullableTypeSyntax or ArrayTypeSyntax: return TypeRef(M.GetTypeInfo(e).Type!);
            case MemberAccessExpressionSyntax ma: return MemberAccess(ma);
            case ConditionalAccessExpressionSyntax ca: return CondAccess(ca);
            case MemberBindingExpressionSyntax mb: return MemberOn(condRecv.Peek(), Sym(mb)!, null, mb, false);
            case ElementBindingExpressionSyntax eb: return ElementOn(condRecv.Peek(), null, eb, eb.ArgumentList.Arguments);
            case ElementAccessExpressionSyntax ea: return ElementAccess(ea);
            case InvocationExpressionSyntax inv: return Invocation(inv);
            case BaseObjectCreationExpressionSyntax oc: return ObjCreation(oc);
            case AnonymousObjectCreationExpressionSyntax aoc:
                return "({ " + string.Join(", ", aoc.Initializers.Select(i => $"{(i.NameEquals?.Name.Identifier.ValueText ?? LastName(i.Expression))}: {Expr(i.Expression)}")) + " })";
            case ArrayCreationExpressionSyntax ac: return ArrayCreation(ac);
            case ImplicitArrayCreationExpressionSyntax iac: return "[" + string.Join(", ", iac.Initializer.Expressions.Select(Expr)) + "]";
            case InitializerExpressionSyntax ie: return "[" + string.Join(", ", ie.Expressions.Select(Expr)) + "]";
            case CollectionExpressionSyntax ce: return CollectionExpr(ce);
            case AssignmentExpressionSyntax a: return Assignment(a);
            case BinaryExpressionSyntax b: return Binary(b);
            case PrefixUnaryExpressionSyntax pu: return Prefix(pu);
            case PostfixUnaryExpressionSyntax po:
                if (po.IsKind(SyntaxKind.SuppressNullableWarningExpression)) return Expr(po.Operand);
                return IncDec(po.Operand, po.IsKind(SyntaxKind.PostIncrementExpression) ? "++" : "--", prefix: false);
            case ConditionalExpressionSyntax c: return $"({Cond(c.Condition)} ? {Expr(c.WhenTrue)} : {Expr(c.WhenFalse)})";
            case CastExpressionSyntax c: return Cast(c);
            case ParenthesizedExpressionSyntax p: { var x = Expr(p.Expression); return x.StartsWith("(") && StripParens(x) != x ? x : $"({x})"; }
            case AnonymousFunctionExpressionSyntax lam: return Lambda(lam);
            case AwaitExpressionSyntax aw: return $"(yield {Expr(aw.Expression)})";
            case ThisExpressionSyntax: return "this";
            case BaseExpressionSyntax: return "this";
            case TypeOfExpressionSyntax t: return TypeRef(M.GetTypeInfo(t.Type).Type!);
            case DefaultExpressionSyntax d: return DefaultOf(M.GetTypeInfo(d.Type).Type);
            case InterpolatedStringExpressionSyntax i: return Interp(i);
            case TupleExpressionSyntax t: return "[" + string.Join(", ", t.Arguments.Select(a => Expr(a.Expression))) + "]";
            case ThrowExpressionSyntax t: return $"$.throw_({Expr(t.Expression)})";
            case SwitchExpressionSyntax s: return SwitchExpr(s);
            case IsPatternExpressionSyntax ip: return IsPattern(ip);
            case QueryExpressionSyntax q: return Query(q);
            case DeclarationExpressionSyntax d: return DeconTarget(d, declare: true);
            case CheckedExpressionSyntax c: return Expr(c.Expression);
            case RefExpressionSyntax r: return Expr(r.Expression);
            case WithExpressionSyntax w: return WithExpr(w);
            case SizeOfExpressionSyntax so: return M.GetConstantValue(so) is { HasValue: true } cv ? cv.Value!.ToString()! : "8";
            case RangeExpressionSyntax: Warn(e, "standalone range"); return "null";
            default:
                Warn(e, "unhandled expr " + e.Kind());
                return $"/* TODO {e.Kind()} */ null";
        }
    }

    static string LastName(ExpressionSyntax e) => e switch
    {
        MemberAccessExpressionSyntax m => m.Name.Identifier.ValueText,
        IdentifierNameSyntax i => i.Identifier.ValueText,
        _ => "x",
    };

    string Literal(LiteralExpressionSyntax l)
    {
        switch (l.Kind())
        {
            case SyntaxKind.NumericLiteralExpression:
                {
                    var v = l.Token.Value;
                    return v switch
                    {
                        double d => FmtNum(d),
                        float f => FmtNum(f),
                        decimal m => m.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        ulong u when u > 9007199254740991UL => u.ToString() + "/*precision*/",
                        _ => Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)!,
                    };
                }
            case SyntaxKind.StringLiteralExpression: case SyntaxKind.Utf8StringLiteralExpression:
                return Q(l.Token.ValueText);
            case SyntaxKind.CharacterLiteralExpression: return ((int)(char)l.Token.Value!).ToString();
            case SyntaxKind.TrueLiteralExpression: return "true";
            case SyntaxKind.FalseLiteralExpression: return "false";
            case SyntaxKind.NullLiteralExpression: return "null";
            case SyntaxKind.DefaultLiteralExpression: return DefaultOf(M.GetTypeInfo(l).ConvertedType);
        }
        return l.ToString();
    }

    // ---------------------------------------------------------------- names & member access
    string Name(SimpleNameSyntax n)
    {
        var sym = Sym(n);
        if (sym == null)
        {
            if (n.Identifier.ValueText == "value") return "value";
            var pm = System.Text.RegularExpressions.Regex.Match(n.Identifier.ValueText, "^_003C(\\w+)_003EP$");
            if (pm.Success) return "this.$p_" + pm.Groups[1].Value;
            Warn(n, "unresolved name");
            return Ctx.SafeLocal(n.Identifier.ValueText);
        }
        if (symOverride.TryGetValue(sym, out var ov)) return ov;
        if (sym is IMethodSymbol ms && ms.MethodKind == MethodKind.LocalFunction) return Ctx.SafeLocal(ms.Name);
        switch (sym)
        {
            case ILocalSymbol l: return Ctx.SafeLocal(l.Name);
            case IParameterSymbol p: return Ctx.SafeLocal(p.Name);
            case IRangeVariableSymbol r: return Ctx.SafeLocal(r.Name);
            case ITypeSymbol t: return TypeRef(t);
            case INamespaceSymbol: return "";
            case IAliasSymbol a: return a.Target is ITypeSymbol at ? TypeRef(at) : "";
            case IMethodSymbol m: return MethodGroup(m, m.IsStatic ? null : "this", n);
            case IFieldSymbol or IPropertySymbol or IEventSymbol:
                if (sym.IsStatic || sym is IFieldSymbol { IsConst: true }) return MemberOn(TypeRef(sym.ContainingType), sym, sym.ContainingType, n, isStaticRecv: true);
                return MemberOn("this", sym, sym.ContainingType, n, false);
            case IDiscardSymbol: return "$.discard";
        }
        Warn(n, "unknown symbol kind " + sym.Kind);
        return Ctx.SafeLocal(n.Identifier.ValueText);
    }

    bool IsBaseRecv(ExpressionSyntax? e) => e is BaseExpressionSyntax;

    string MemberAccess(MemberAccessExpressionSyntax ma)
    {
        var sym = Sym(ma);
        if (sym == null) { Warn(ma, "unresolved member"); return Expr(ma.Expression) + "." + ma.Name.Identifier.ValueText; }
        if (sym is INamespaceSymbol) return "";
        if (sym is ITypeSymbol ts) return TypeRef(ts);
        var recvSym = Sym(ma.Expression);
        bool staticRecv = recvSym is ITypeSymbol || recvSym is INamespaceSymbol;
        if (sym is IMethodSymbol m)
        {
            if (IsBaseRecv(ma.Expression)) return $"$.bindFn(this, {BaseProtoCur()}.{C.MethodName(m)})";
            return MethodGroup(m, m.IsStatic ? null : Recv(ma.Expression), ma);
        }
        if (IsBaseRecv(ma.Expression) && !IsVirtualish(sym)) return MemberOn("this", sym, CurType, ma, false);
        if (IsBaseRecv(ma.Expression))
        {
            if (sym is IPropertySymbol) return $"$.superGet({BaseProtoCur()}, \"{C.MemberName(sym)}\", this)";
            return "this." + C.MemberName(sym);
        }
        var recv = staticRecv ? TypeRef((ITypeSymbol)(recvSym is IAliasSymbol al ? al.Target : recvSym!)) : Recv(ma.Expression);
        return MemberOn(recv, sym, staticRecv ? null : M.GetTypeInfo(ma.Expression).Type, ma, staticRecv || sym.IsStatic);
    }

    string BaseProtoCur()
    {
        var bt = CurType.BaseType!;
        return (C.IsIncluded(bt) ? C.TypeId(bt) : C.ExtAlias(bt)) + ".prototype";
    }

    /// base.X only needs non-virtual dispatch when X can be overridden below the current type.
    bool IsVirtualish(ISymbol s) => s.IsVirtual || s.IsAbstract || s.IsOverride;

    string Recv(ExpressionSyntax e)
    {
        var s = Expr(e);
        if (e is LiteralExpressionSyntax { RawKind: (int)SyntaxKind.NumericLiteralExpression }) return $"({s})";
        if (s.StartsWith("new ") && !s.Contains(".$ctor")) return $"({s})";
        return s;
    }

    string MemberOn(string recv, ISymbol sym, ITypeSymbol? recvType, SyntaxNode node, bool isStaticRecv)
    {
        var ct = sym.ContainingType;
        if (sym is IFieldSymbol f)
        {
            if (ct != null && ct.IsTupleType)
            {
                var idx = TupleIndex(f);
                return $"{recv}[{idx}]";
            }
            if (f.IsConst || (ct?.TypeKind == TypeKind.Enum))
            {
                if (ct != null && C.IsIncluded(ct)) return $"{C.TypeId(ct)}.{Ctx.CleanName(f.Name)}";
                if (f.HasConstantValue) return $"{ConstLit(f.ConstantValue, null)} /*{ct?.Name}.{f.Name}*/";
            }
        }
        if (sym is IPropertySymbol p && ct != null)
        {
            var key = Ctx.TypeKey(ct) + "::" + p.Name;
            switch (key)
            {
                case "System.Array::Length": case "System.Array::LongLength": case "System.String::Length":
                case "System.Span`1::Length": case "System.ReadOnlySpan`1::Length": case "System.Memory`1::Length": case "System.ReadOnlyMemory`1::Length": return recv + ".length";
                case "System.Span`1::IsEmpty": case "System.ReadOnlySpan`1::IsEmpty": return $"({recv}.length === 0)";
                case "System.Nullable`1::Value": return recv;
                case "System.Nullable`1::HasValue": return $"({recv} != null)";
                case "System.Collections.Generic.KeyValuePair`2::Key": return recv + "[0]";
                case "System.Collections.Generic.KeyValuePair`2::Value": return recv + "[1]";
            }
            // IReadOnlyCollection<T> & co. may be a HashSet/Dictionary/custom collection at runtime: arrays have a Count getter too
            if (p.Name == "Count" && recvType != null && Ctx.IsArrayLike(recvType)) return recv + (recvType.TypeKind == TypeKind.Interface ? ".Count" : ".length");
        }
        if (ct != null && !ct.IsAnonymousType)
        {
            C.UseExt(sym);
            if (sym.IsStatic && !C.IsIncluded(ct) && !Ctx.IsBcl(ct)) recv = C.ExtAlias(ct);
        }
        if (sym.IsStatic && ct != null && isStaticRecv) recv = StaticOwner(ct);
        return $"{recv}.{C.MemberName(sym)}";
    }

    static int TupleIndex(IFieldSymbol f)
    {
        var cf = f.CorrespondingTupleField ?? f;
        var name = cf.Name;
        if (name.StartsWith("Item") && int.TryParse(name[4..], out var n)) return n - 1;
        var idx = f.ContainingType.TupleElements.IndexOf(f);
        return idx < 0 ? 0 : idx;
    }

    string MethodGroup(IMethodSymbol m, string? recv, SyntaxNode node)
    {
        var name = C.MethodName(m);
        C.UseExt(m);
        string target;
        if (m.IsStatic)
        {
            target = $"{StaticOwner(m.ContainingType)}.{name}";
            if (m.IsGenericMethod && C.IsIncluded(m.ContainingType))
                return $"((...a) => {target}({string.Join(", ", m.TypeArguments.Select(TypeRef))}, ...a))";
            if (m.IsExtensionMethod && m.ReducedFrom != null && recv != null) return $"((...a) => {target}({recv}, ...a))";
            return target;
        }
        if (m.ReducedFrom != null)
        {
            var sname = C.MethodName(m.ReducedFrom);
            return $"((...a) => {TypeRef(m.ContainingType)}.{sname}({recv}, ...a))";
        }
        if (recv == "this") return $"$.bindFn(this, this.{name})";
        var t = Temp();
        return $"({t} = {recv}, $.bindFn({t}, {t}.{name}))";
    }

    string CondAccess(ConditionalAccessExpressionSyntax ca)
    {
        var recv = Recv(ca.Expression);
        condRecv.Push(CondPh);
        var body = Expr(ca.WhenNotNull);
        condRecv.Pop();
        int count = body.Split(CondPh).Length - 1;
        if (count == 1 && body.Length > 0 && body[0] == CondPh[0])
        {
            var rest = body[1..];
            if (rest.Length == 0) return recv;
            if (rest.StartsWith(".")) return recv + "?" + rest;
            if (rest.StartsWith("[") || rest.StartsWith("(")) return recv + "?." + rest;
        }
        var t = Temp();
        return $"(({t} = {recv}) == null ? null : {body.Replace(CondPh, t)})";
    }

    // ---------------------------------------------------------------- element access
    string ElementAccess(ElementAccessExpressionSyntax ea)
    {
        if (IsBaseRecv(ea.Expression)) Warn(ea, "base indexer");
        return ElementOn(Recv(ea.Expression), M.GetTypeInfo(ea.Expression).Type, ea, ea.ArgumentList.Arguments);
    }

    string ElementOn(string recv, ITypeSymbol? rt, ExpressionSyntax node, SeparatedSyntaxList<ArgumentSyntax> args)
    {
        var prop = Sym(node) as IPropertySymbol;
        if (rt == null && prop != null) rt = prop.ContainingType;
        if (rt is IArrayTypeSymbol at && at.Rank > 1) return recv + string.Concat(args.Select(a => $"[{Expr(a.Expression)}]"));
        if (Ctx.IsString(rt))
        {
            var a0 = args[0].Expression;
            if (a0 is RangeExpressionSyntax rg) return $"{recv}.substring({RangeArgs(recv, rg)})";
            return $"{recv}.charCodeAt({IndexArg(recv, a0)})";
        }
        // Char spans are backed by either a string or a char-code array; reads must yield a char code for both.
        if (IsCharSpan(rt) && args[0].Expression is not RangeExpressionSyntax && !IsWriteTarget(node))
            return $"$.chAt({recv}, {IndexArg(recv, args[0].Expression)})";
        if (rt != null && (Ctx.IsArrayLike(rt) || rt is IArrayTypeSymbol))
        {
            var a0 = args[0].Expression;
            if (a0 is RangeExpressionSyntax rg) return $"{recv}.slice({RangeArgs(recv, rg)})";
            // IList<T>/IReadOnlyList<T> reads may hit a non-array implementation (get_Item)
            if (rt.TypeKind == TypeKind.Interface && !IsWriteTarget(node) && a0 is not PrefixUnaryExpressionSyntax { RawKind: (int)SyntaxKind.IndexExpression })
                return $"$.at({recv}, {Expr(a0)})";
            return $"{recv}[{IndexArg(recv, a0)}]";
        }
        if (prop != null)
        {
            C.UseExt(prop);
            var getName = C.IsIncluded(prop.ContainingType) && prop.GetMethod != null ? C.MethodName(prop.GetMethod) : "get_Item";
            return $"{recv}.{getName}({string.Join(", ", args.Select(a => Expr(a.Expression)))})";
        }
        return $"{recv}[{Expr(args[0].Expression)}]";
    }

    static bool IsCharSpan(ITypeSymbol? t) => t is INamedTypeSymbol { TypeArguments.Length: 1 } n && Ctx.TypeKey(n) is "System.Span`1" or "System.ReadOnlySpan`1" && n.TypeArguments[0].SpecialType == SpecialType.System_Char;

    static bool IsWriteTarget(ExpressionSyntax node) => node.Parent switch
    {
        AssignmentExpressionSyntax a => a.Left == node,
        PostfixUnaryExpressionSyntax or PrefixUnaryExpressionSyntax { RawKind: (int)SyntaxKind.PreIncrementExpression or (int)SyntaxKind.PreDecrementExpression } => true,
        ArgumentSyntax arg => !arg.RefKindKeyword.IsKind(SyntaxKind.None),
        _ => false,
    };

    string IndexArg(string recv, ExpressionSyntax a)
    {
        if (a is PrefixUnaryExpressionSyntax pu && pu.IsKind(SyntaxKind.IndexExpression)) return $"{recv}.length - {Expr(pu.Operand)}";
        return Expr(a);
    }

    string RangeArgs(string recv, RangeExpressionSyntax r)
    {
        string B(ExpressionSyntax? x, string dflt) => x == null ? dflt : x is PrefixUnaryExpressionSyntax pu && pu.IsKind(SyntaxKind.IndexExpression) ? $"{recv}.length - {Expr(pu.Operand)}" : Expr(x);
        return $"{B(r.LeftOperand, "0")}, {B(r.RightOperand, $"{recv}.length")}";
    }

    // ---------------------------------------------------------------- invocation
    sealed class ArgCtx { public List<string> Pre = new(); public List<string> Post = new(); }
    ArgCtx? argCtx;

    string Invocation(InvocationExpressionSyntax inv)
    {
        if (inv.Expression is IdentifierNameSyntax { Identifier.ValueText: "nameof" } && Sym(inv.Expression) == null)
            return Q(LastName(inv.ArgumentList.Arguments[0].Expression) is var ln && inv.ArgumentList.Arguments[0].Expression is GenericNameSyntax gn ? gn.Identifier.ValueText : ln);
        var exprText = inv.Expression.ToString();
        if (exprText.Contains("_003CPrivateImplementationDetails_003E"))
        {
            var a = inv.ArgumentList.Arguments.Select(x => Expr(x.Expression)).ToList();
            if (exprText.Contains("ThrowSwitchExpressionException")) return $"$.throwSwitch({string.Join(", ", a)})";
            if (exprText.Contains("InlineArrayElementRef")) return $"{a[0]}[{a[1]}]";
            if (exprText.Contains("InlineArrayAsReadOnlySpan") || exprText.Contains("InlineArrayAsSpan")) return $"{a[0]}.slice(0, {a[1]})";
            Warn(inv, "private impl helper");
            return "undefined";
        }
        if (inv.Expression is MemberAccessExpressionSyntax { Name.Identifier.ValueText: "_002Ector" } bctor)
        {
            var bt = IsBaseRecv(bctor.Expression) ? CurType.BaseType : CurType;
            if (bt == null || bt.SpecialType == SpecialType.System_Object || !C.IsIncluded(bt)) return "undefined";
            var n = inv.ArgumentList.Arguments.Count;
            var target = bt.InstanceConstructors.FirstOrDefault(c => c.Parameters.Length == n) ?? bt.InstanceConstructors.First();
            var args0 = inv.ArgumentList.Arguments.Select(x => Expr(x.Expression)).ToList();
            for (int i = args0.Count; i < target.Parameters.Length; i++) args0.Add(DefaultParam(target.Parameters[i]));
            return $"this.{C.CtorName(target)}({string.Join(", ", bt.TypeArguments.Select(TypeRef).Concat(args0))})";
        }
        var op = M.GetOperation(inv);
        if (op is not IInvocationOperation io)
        {
            if (op is IDynamicInvocationOperation) Warn(inv, "dynamic");
            else Warn(inv, "invocation without symbol: " + op?.Kind);
            if (Sym(inv) is IMethodSymbol cand)
            {
                var slots = new string?[cand.Parameters.Length];
                int pos = 0;
                foreach (var a in inv.ArgumentList.Arguments)
                {
                    var idx = a.NameColon != null ? cand.Parameters.IndexOf(cand.Parameters.FirstOrDefault(pp => pp.Name == a.NameColon.Name.Identifier.ValueText)!) : pos++;
                    if (idx >= 0 && idx < slots.Length) slots[idx] = Expr(a.Expression);
                }
                var fargs = cand.Parameters.Select((pp, i) => slots[i] ?? (pp.IsParams ? "[]" : DefaultParam(pp))).ToList();
                var tas = cand.IsGenericMethod && C.IsIncluded(cand.ContainingType) ? cand.TypeArguments.Select(TypeRef).ToList() : new List<string>();
                var nm = C.MethodName(cand);
                string head = cand.IsStatic || cand.IsExtensionMethod ? $"{TypeRef((cand.ReducedFrom ?? cand).ContainingType)}.{nm}"
                    : inv.Expression is MemberAccessExpressionSyntax fma ? $"{Recv(fma.Expression)}.{nm}" : $"this.{nm}";
                if (cand.ReducedFrom != null && inv.Expression is MemberAccessExpressionSyntax rma) fargs.Insert(0, Recv(rma.Expression));
                return $"{head}({string.Join(", ", tas.Concat(fargs))})";
            }
            return $"{Expr(inv.Expression)}({string.Join(", ", inv.ArgumentList.Arguments.Select(a => Expr(a.Expression)))})";
        }
        var m = io.TargetMethod;
        var saved = argCtx;
        argCtx = new ArgCtx();
        string call;
        try { call = InvocationCore(inv, io, m); }
        finally { }
        var ac = argCtx;
        argCtx = saved;
        if (ac.Pre.Count == 0 && ac.Post.Count == 0) return call;
        if (m.ReturnsVoid) return "(" + string.Join(", ", ac.Pre.Append(call).Concat(ac.Post)) + ")";
        var rt = Temp("$c");
        return "(" + string.Join(", ", ac.Pre.Append($"{rt} = {call}").Concat(ac.Post).Append(rt)) + ")";
    }

    static readonly HashSet<string> BclGenericRt = new() { "GetCustomAttribute", "GetCustomAttributes", "IsDefined", "Deserialize", "Serialize", "SerializeToNode", "SerializeToElement", "DeserializeAsync", "SerializeAsync", "OfType", "Cast", "GetValues", "CreateInstance", "Parse", "TryParse", "GetNames", "IsDefined", "GetValuesAsUnderlyingType" };

    string InvocationCore(InvocationExpressionSyntax inv, IInvocationOperation io, IMethodSymbol m)
    {
        var args = ArgList(io.Arguments, m);
        // delegate invocation
        if (m.MethodKind == MethodKind.DelegateInvoke)
        {
            var calleeExpr = inv.Expression is MemberAccessExpressionSyntax { Name.Identifier.ValueText: "Invoke" } mi && Sym(mi.Expression) is not IMethodSymbol ? mi.Expression : inv.Expression;
            if (inv.Expression is MemberBindingExpressionSyntax { Name.Identifier.ValueText: "Invoke" }) return $"{condRecv.Peek()}({string.Join(", ", args)})";
            return $"{Recv(calleeExpr)}({string.Join(", ", args)})";
        }
        if (m.MethodKind == MethodKind.LocalFunction)
        {
            var targs = m.TypeArguments.Select(TypeRef);
            return $"{Ctx.SafeLocal(m.Name)}({string.Join(", ", targs.Concat(args))})";
        }
        var def = m.ReducedFrom ?? m;
        var key = Ctx.TypeKey(def.ContainingType) + "::" + def.Name;
        var special = SpecialCall(key, inv, io, m, args);
        if (special != null) return special;

        var typeArgs = new List<string>();
        if (m.IsGenericMethod && (C.IsIncluded(m.ContainingType) || BclGenericRt.Contains(m.Name) || !Ctx.IsBcl(m.ContainingType)))
            typeArgs.AddRange(m.TypeArguments.Select(TypeRef));
        C.UseExt(def);
        var name = C.MethodName(m);
        bool isExt = m.IsExtensionMethod || (m.ReducedFrom != null);
        if (m.IsStatic || isExt)
        {
            var owner = StaticOwner(def.ContainingType);
            return $"{owner}.{name}({string.Join(", ", typeArgs.Concat(args))})";
        }
        // instance
        string recv;
        switch (inv.Expression)
        {
            case MemberAccessExpressionSyntax ma when IsBaseRecv(ma.Expression) && !IsVirtualish(m):
                recv = "this"; break;
            case MemberAccessExpressionSyntax ma when IsBaseRecv(ma.Expression):
                return $"{BaseProtoCur()}.{name}.call({string.Join(", ", typeArgs.Prepend("this").Concat(args))})";
            case MemberAccessExpressionSyntax ma: recv = Recv(ma.Expression); break;
            case MemberBindingExpressionSyntax: recv = condRecv.Peek(); break;
            default: recv = "this"; break;
        }
        return $"{recv}.{name}({string.Join(", ", typeArgs.Concat(args))})";
    }

    string RecvOf(InvocationExpressionSyntax inv, IInvocationOperation io)
    {
        switch (inv.Expression)
        {
            case MemberAccessExpressionSyntax ma: return Recv(ma.Expression);
            case MemberBindingExpressionSyntax: return condRecv.Peek();
            default: return "this";
        }
    }
    ITypeSymbol? RecvType(InvocationExpressionSyntax inv) =>
        inv.Expression is MemberAccessExpressionSyntax ma ? M.GetTypeInfo(ma.Expression).Type : null;

    string? SpecialCall(string key, InvocationExpressionSyntax inv, IInvocationOperation io, IMethodSymbol m, List<string> args)
    {
        switch (key)
        {
            case "System.Object::ToString": case "System.Enum::ToString": case "System.ValueType::ToString":
            case "System.Int32::ToString": case "System.Char::ToString": case "System.Boolean::ToString":
                {
                    if (m.IsStatic) break;
                    var rt = RecvType(inv) ?? io.Instance?.Type;
                    var recv = RecvOf(inv, io);
                    if (rt != null && Ctx.Unnull(rt).TypeKind == TypeKind.Enum) return EnumStr(recv, Ctx.Unnull(rt));
                    if (Ctx.IsChar(rt)) return $"String.fromCharCode({recv})";
                    var fmtArgs = args.Where((a, i) => i < m.Parameters.Length && Ctx.IsString(m.Parameters[i].Type)).ToList();
                    if (fmtArgs.Count > 0) return $"$.fmt({recv}, {fmtArgs[0]})";
                    return $"$.str({recv})";
                }
            case "System.Text.StringBuilder::Append": case "System.Text.StringBuilder::Insert":
                {
                    // chars are numbers at runtime: Append(char) must not append the code as an int
                    var a2 = args.ToList();
                    bool any = false;
                    for (int i = 0; i < m.Parameters.Length && i < a2.Count; i++)
                    {
                        var pt = m.Parameters[i].Type;
                        if (Ctx.IsChar(pt)) { a2[i] = $"String.fromCharCode({a2[i]})"; any = true; }
                        else if (pt is IArrayTypeSymbol { ElementType.SpecialType: SpecialType.System_Char }) { a2[i] = $"$.charsToStr({a2[i]})"; any = true; }
                    }
                    if (!any) break;
                    return $"{RecvOf(inv, io)}.{m.Name}({string.Join(", ", a2)})";
                }
            case "System.Object::GetType": return $"$.getType({RecvOf(inv, io)})";
            case "System.Object::Equals":
                if (m.IsStatic) return $"$.equals({args[0]}, {args[1]})";
                return $"$.equals({RecvOf(inv, io)}, {args[0]})";
            case "System.Object::GetHashCode": return $"$.hash({RecvOf(inv, io)})";
            case "System.Object::ReferenceEquals": return $"({args[0]} === {args[1]})";
            case "System.Enum::HasFlag": return $"$.hasFlag({RecvOf(inv, io)}, {args[0]})";
            case "System.Nullable`1::GetValueOrDefault": return $"({RecvOf(inv, io)} ?? {(args.Count > 0 ? args[0] : DefaultOf(((INamedTypeSymbol)m.ContainingType).TypeArguments[0]))})";
            case "System.Threading.Tasks.Task::ConfigureAwait": case "System.Threading.Tasks.Task`1::ConfigureAwait": return RecvOf(inv, io);
            case "System.Array::Empty": case "System.Linq.Enumerable::Empty": return "[]";
            case "System.Math::Round": case "System.Decimal::Round": case "System.MathF::Round":
                {
                    var ps = m.Parameters;
                    string x = args[0], digits = "0", mode = "0";
                    for (int i = 1; i < ps.Length; i++)
                        if (ps[i].Type.TypeKind == TypeKind.Enum) mode = args[i]; else digits = args[i];
                    return $"$.round({x}, {digits}, {mode})";
                }
        }
        if (m.Name == "ToString" && m.Parameters.Length == 0 && IsCharSpan(m.ContainingType)) return $"$.spanStr({RecvOf(inv, io)})";
        if (m.ContainingType.IsTupleType || m.ContainingType.Name == "ValueTuple")
        {
            if (m.Name == "CompareTo") return $"$.compare({RecvOf(inv, io)}, {args[0]})";
            if (m.Name == "Equals") return $"$.tupleEq({RecvOf(inv, io)}, {args[0]})";
            if (m.Name == "GetHashCode") return $"$.hash({RecvOf(inv, io)})";
            if (m.Name == "ToString") return $"$.tupleStr({RecvOf(inv, io)})";
        }
        if (m.Name == "Equals" && !m.IsStatic && m.Parameters.Length == 1 && Ctx.IsBcl(m.ContainingType) && m.ContainingType.SpecialType != SpecialType.None)
            return $"$.equals({RecvOf(inv, io)}, {args[0]})";
        if (m.Name == "CompareTo" && !m.IsStatic && m.Parameters.Length == 1 && m.ContainingType.SpecialType != SpecialType.None)
            return $"$.compare({RecvOf(inv, io)}, {args[0]})";
        if (m.Name == "GetHashCode" && !m.IsStatic && m.Parameters.Length == 0 && m.ContainingType.SpecialType != SpecialType.None)
            return $"$.hash({RecvOf(inv, io)})";
        return null;
    }

    string EnumStr(string v, ITypeSymbol et) => $"$.enumStr({TypeRef(et)}, {v})";

    List<string> ArgList(IEnumerable<IArgumentOperation> args, IMethodSymbol m)
    {
        var ps = m.Parameters;
        var slots = new string?[ps.Length];
        var extra = new List<string>();
        foreach (var a in args)
        {
            var p = a.Parameter;
            var v = ArgValue(a, p);
            if (p == null || p.Ordinal >= slots.Length) extra.Add(v);
            else slots[p.Ordinal] = v;
        }
        var list = new List<string>();
        for (int i = 0; i < slots.Length; i++) list.Add(slots[i] ?? (ps[i].IsParams ? "[]" : DefaultParam(ps[i])));
        list.AddRange(extra);
        return list;
    }

    readonly HashSet<SyntaxNode> opGuard = new();

    string ArgValue(IArgumentOperation a, IParameterSymbol? p)
    {
        if (a.Value is IInterpolatedStringHandlerCreationOperation ih && ih.Content.Syntax is ExpressionSyntax ihs) return Expr(ihs);
        switch (a.ArgumentKind)
        {
            case ArgumentKind.DefaultValue:
                if (a.Value.ConstantValue.HasValue) return ConstLit(a.Value.ConstantValue.Value, p?.Type);
                return p != null ? DefaultParam(p) : "undefined";
            case ArgumentKind.ParamCollection:
                if (a.Value is ICollectionExpressionOperation pce)
                    return "[" + string.Join(", ", pce.Elements.Select(el => el is ISpreadOperation sp ? "..." + OpExpr(sp.Operand) : OpExpr(el))) + "]";
                break;
            case ArgumentKind.ParamArray:
                if (a.Value is IArrayCreationOperation ac)
                    return "[" + string.Join(", ", ac.Initializer?.ElementValues.Select(OpExpr) ?? Enumerable.Empty<string>()) + "]";
                return OpExpr(a.Value);
        }
        var syn = a.Syntax as ArgumentSyntax;
        if (p != null && p.RefKind is RefKind.Out or RefKind.Ref && syn != null) return RefArg(syn.Expression, p);
        if (syn != null) return Expr(syn.Expression);
        return OpExpr(a.Value);
    }

    string OpExpr(IOperation v)
    {
        while (v is IConversionOperation { IsImplicit: true } c && c.Operand.Syntax == v.Syntax) v = c.Operand;
        switch (v)
        {
            case IConditionalAccessInstanceOperation: return condRecv.Peek();
            case IInstanceReferenceOperation { IsImplicit: true }: return "this";
            case IConversionOperation { IsImplicit: true } c when c.Operand is IConditionalAccessInstanceOperation: return condRecv.Peek();
        }
        if (v is IInterpolatedStringHandlerCreationOperation ih && ih.Content.Syntax is ExpressionSyntax ihs) return Expr(ihs);
        if (!opGuard.Add(v.Syntax)) { Warn(v.Syntax, "recursive operation " + v.Kind); return "undefined"; }
        try
        {
            if (v.Syntax is ExpressionSyntax es) return Expr(es);
            if (v.Syntax is ArgumentSyntax asy) return Expr(asy.Expression);
        }
        finally { opGuard.Remove(v.Syntax); }
        if (v.ConstantValue.HasValue) return ConstLit(v.ConstantValue.Value, v.Type);
        Warn(v.Syntax, "operation without expression syntax " + v.Kind);
        return "undefined";
    }

    string RefArg(ExpressionSyntax e, IParameterSymbol p)
    {
        var ac = argCtx!;
        // passing through an existing ref/out parameter box
        if (e is IdentifierNameSyntax id && Sym(id) is IParameterSymbol ps && ps.RefKind is RefKind.Out or RefKind.Ref && symOverride.TryGetValue(ps, out var ov) && ov.EndsWith(".v"))
            return ov[..^2];
        var box = Temp("$r");
        switch (e)
        {
            case DeclarationExpressionSyntax { Designation: SingleVariableDesignationSyntax sv }:
                {
                    var n = Ctx.SafeLocal(sv.Identifier.ValueText);
                    Hoist(n);
                    ac.Pre.Add($"{box} = {{ v: undefined }}");
                    ac.Post.Add($"{n} = {box}.v");
                    return box;
                }
            case DeclarationExpressionSyntax { Designation: DiscardDesignationSyntax }:
            case IdentifierNameSyntax { Identifier.ValueText: "_" } when Sym(e) is IDiscardSymbol or null:
                ac.Pre.Add($"{box} = {{ v: undefined }}");
                return box;
            default:
                {
                    var target = Expr(e);
                    ac.Pre.Add(p.RefKind == RefKind.Ref ? $"{box} = {{ v: {target} }}" : $"{box} = {{ v: undefined }}");
                    ac.Post.Add(AssignTo(e, $"{box}.v"));
                    return box;
                }
        }
    }

    /// Get-only auto-properties are assigned through their backing field (C# never dispatches to an override here).
    string? AutoPropBacking(ExpressionSyntax left)
    {
        if (Sym(left) is not IPropertySymbol ps || ps.SetMethod != null || ps.IsIndexer || !C.IsIncluded(ps.ContainingType) || !IsAutoProp(ps)) return null;
        var n = Ctx.CleanName(ps.Name);
        if (ps.IsStatic) return $"{C.TypeId(ps.ContainingType)}.$s_{n}";
        var recv = left is MemberAccessExpressionSyntax ma && ma.Expression is not (ThisExpressionSyntax or BaseExpressionSyntax) ? Recv(ma.Expression) : "this";
        return $"{recv}.$_{n}";
    }

    string AssignTo(ExpressionSyntax target, string value)
    {
        if (AutoPropBacking(target) is { } bk) return $"{bk} = {value}";
        if (target is ElementAccessExpressionSyntax ea && Sym(ea) is IPropertySymbol ip && !Ctx.IsArrayLike(M.GetTypeInfo(ea.Expression).Type) && M.GetTypeInfo(ea.Expression).Type is not IArrayTypeSymbol)
        {
            var setName = C.IsIncluded(ip.ContainingType) && ip.SetMethod != null ? C.MethodName(ip.SetMethod) : "set_Item";
            C.UseExt(ip);
            return $"{Recv(ea.Expression)}.{setName}({string.Join(", ", ea.ArgumentList.Arguments.Select(a => Expr(a.Expression)).Append(value))})";
        }
        if (target is MemberAccessExpressionSyntax ma && IsBaseRecv(ma.Expression) && Sym(ma) is IPropertySymbol bp)
            return $"$.superSet({BaseProtoCur()}, \"{C.MemberName(bp)}\", this, {value})";
        return $"{Expr(target)} = {value}";
    }

    // ---------------------------------------------------------------- object creation
    string ObjCreation(BaseObjectCreationExpressionSyntax oc)
    {
        var op = M.GetOperation(oc);
        if (M.GetTypeInfo(oc).Type is ITypeParameterSymbol tps)
        {
            var created = $"$.create({TypeRef(tps)})";
            return oc.Initializer == null ? created : Initializer(created, oc.Initializer, tps, false);
        }
        var type = M.GetTypeInfo(oc).Type as INamedTypeSymbol;
        if (op is IDelegateCreationOperation dc)
        {
            if (oc.ArgumentList?.Arguments.Count == 1) return Expr(oc.ArgumentList.Arguments[0].Expression);
            return OpExpr(dc.Target);
        }
        if (type == null) { Warn(oc, "unknown created type"); return "null"; }
        if (type.IsTupleType) return "[" + string.Join(", ", oc.ArgumentList?.Arguments.Select(a => Expr(a.Expression)) ?? Array.Empty<string>()) + "]";
        if (type.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T) return oc.ArgumentList?.Arguments.Count > 0 ? Expr(oc.ArgumentList.Arguments[0].Expression) : "null";
        var oco = op as IObjectCreationOperation;
        var ctor = oco?.Constructor;
        List<string> pre = new(), post = new();
        var args = oco != null && ctor != null ? ArgListWrapped(oco.Arguments, ctor, out pre, out post) : (oc.ArgumentList?.Arguments.Select(a => Expr(a.Expression)).ToList() ?? new List<string>());
        string baseExpr;
        var key = Ctx.TypeKey(type);
        bool arrayRepr = false;
        if (C.IsIncluded(type))
        {
            var id = C.TypeId(type);
            var targs = type.TypeArguments.Select(TypeRef);
            if (ctor == null) { Warn(oc, "no ctor"); baseExpr = $"new {id}()"; }
            else if (type.TypeKind == TypeKind.Struct && ctor.IsImplicitlyDeclared && ctor.Parameters.Length == 0) baseExpr = $"new {id}().$zero_{id}()";
            else baseExpr = $"new {id}().{C.CtorName(ctor)}({string.Join(", ", targs.Concat(args))})";
        }
        else if (key is "System.Collections.Generic.List`1" or "System.Collections.ObjectModel.Collection`1")
        {
            arrayRepr = true;
            baseExpr = args.Count == 1 && ctor != null && ctor.Parameters[0].Type.SpecialType != SpecialType.System_Int32 ? $"$.toArray({args[0]})" : "[]";
        }
        else if (type.Name.Contains("ReadOnlyArray") || type.Name.Contains("ReadOnlyList") || key is "System.Collections.ObjectModel.ReadOnlyCollection`1")
            baseExpr = args.Count > 0 ? args[0] : "[]";
        else if (type.Name.Contains("ReadOnlySingleElementList")) baseExpr = $"[{args[0]}]";
        else if (key is "System.Collections.Generic.KeyValuePair`2") baseExpr = $"[{args[0]}, {args[1]}]";
        else if (key is "System.Span`1" or "System.ReadOnlySpan`1") baseExpr = $"$.span({string.Join(", ", args)})";
        else if (key is "System.Object") baseExpr = "{}";
        else if (key is "System.String") baseExpr = $"$.newString({string.Join(", ", args)})";
        else
        {
            if (ctor != null) C.UseExt(ctor);
            baseExpr = $"new {TypeRef(type)}({string.Join(", ", args)})";
        }
        if (oco != null && ctor != null && (pre.Count + post.Count) > 0)
        {
            var rt = Temp("$c");
            baseExpr = "(" + string.Join(", ", pre.Append($"{rt} = {baseExpr}").Concat(post).Append(rt)) + ")";
        }
        if (oc.Initializer == null) return baseExpr;
        return Initializer(baseExpr, oc.Initializer, type, arrayRepr);
    }

    List<string> ArgListWrapped(IEnumerable<IArgumentOperation> args, IMethodSymbol m, out List<string> pre, out List<string> post)
    {
        var saved = argCtx;
        argCtx = new ArgCtx();
        var list = ArgList(args, m);
        pre = argCtx.Pre; post = argCtx.Post;
        argCtx = saved;
        return list;
    }

    string Initializer(string baseExpr, InitializerExpressionSyntax init, ITypeSymbol type, bool arrayRepr)
    {
        if (init.IsKind(SyntaxKind.CollectionInitializerExpression) && arrayRepr && baseExpr == "[]" && init.Expressions.All(x => x is not InitializerExpressionSyntax))
            return "[" + string.Join(", ", init.Expressions.Select(Expr)) + "]";
        var o = Temp("$o");
        var parts = new List<string> { $"{o} = {baseExpr}" };
        InitInto(o, init, parts);
        parts.Add(o);
        return "(" + string.Join(", ", parts) + ")";
    }

    void InitInto(string o, InitializerExpressionSyntax init, List<string> parts)
    {
        foreach (var x in init.Expressions)
        {
            if (init.IsKind(SyntaxKind.ObjectInitializerExpression) || init.IsKind(SyntaxKind.WithInitializerExpression))
            {
                if (x is AssignmentExpressionSyntax a)
                {
                    string target;
                    if (a.Left is ImplicitElementAccessSyntax iea)
                    {
                        var ip = Sym(iea) as IPropertySymbol;
                        var setName = ip != null && C.IsIncluded(ip.ContainingType) && ip.SetMethod != null ? C.MethodName(ip.SetMethod) : "set_Item";
                        if (ip != null) C.UseExt(ip);
                        var idx = string.Join(", ", iea.ArgumentList.Arguments.Select(y => Expr(y.Expression)));
                        if (a.Right is InitializerExpressionSyntax) { Warn(a, "nested indexer initializer"); continue; }
                        parts.Add($"{o}.{setName}({idx}, {Expr(a.Right)})");
                        continue;
                    }
                    var ms = Sym(a.Left);
                    target = ms != null ? MemberOn(o, ms, null, a.Left, false) : $"{o}.{a.Left}";
                    if (a.Right is InitializerExpressionSyntax nested)
                    {
                        if (nested.IsKind(SyntaxKind.CollectionInitializerExpression) || nested.IsKind(SyntaxKind.ObjectInitializerExpression)) InitInto(target, nested, parts);
                        else parts.Add($"{target} = {Expr(nested)}");
                    }
                    else parts.Add($"{target} = {Expr(a.Right)}");
                }
                else Warn(x, "odd object initializer element");
            }
            else
            {
                var addSym = M.GetCollectionInitializerSymbolInfo(x).Symbol as IMethodSymbol;
                var addName = addSym != null && C.IsIncluded(addSym.ContainingType) ? C.MethodName(addSym) : "Add";
                if (addSym != null) C.UseExt(addSym);
                if (x is InitializerExpressionSyntax cx) parts.Add($"{o}.{addName}({string.Join(", ", cx.Expressions.Select(Expr))})");
                else parts.Add($"{o}.{addName}({Expr(x)})");
            }
        }
    }

    string ArrayCreation(ArrayCreationExpressionSyntax ac)
    {
        if (ac.Initializer != null) return ArrInit(ac.Initializer);
        var at = (IArrayTypeSymbol)M.GetTypeInfo(ac).Type!;
        var sizes = ac.Type.RankSpecifiers[0].Sizes;
        var elemDefault = ac.Type.RankSpecifiers.Count > 1 ? "null" : DefaultOf(at.ElementType);
        if (sizes.Count == 1) return elemDefault.StartsWith("new ") || elemDefault.StartsWith("$.defaultOf") ? $"$.newArrF({Expr(sizes[0])}, () => {elemDefault})" : $"$.newArr({Expr(sizes[0])}, {elemDefault})";
        return $"$.newArr2({Expr(sizes[0])}, {Expr(sizes[1])}, {DefaultOf(at.ElementType)})";
    }

    string ArrInit(InitializerExpressionSyntax ie) =>
        "[" + string.Join(", ", ie.Expressions.Select(x => x is InitializerExpressionSyntax n ? ArrInit(n) : Expr(x))) + "]";

    string CollectionExpr(CollectionExpressionSyntax ce)
    {
        var elems = ce.Elements.Select(el => el switch
        {
            ExpressionElementSyntax x => Expr(x.Expression),
            SpreadElementSyntax sp => "..." + Iter(Expr(sp.Expression), M.GetTypeInfo(sp.Expression).Type),
            _ => "null",
        });
        var arr = "[" + string.Join(", ", elems) + "]";
        var target = M.GetTypeInfo(ce).ConvertedType as INamedTypeSymbol;
        if (target != null && !Ctx.IsArrayLike(target) && target.TypeKind != TypeKind.Array)
        {
            var key = Ctx.TypeKey(target);
            if (key.Contains("HashSet") || key.Contains("ISet")) return $"new {C.ExtAlias(target.OriginalDefinition.ContainingNamespace.ToDisplayString() == "System.Collections.Generic" && key.Contains("ISet") ? target : target)}({arr})";
            if (key.Contains("Dictionary")) { Warn(ce, "dictionary collection expression"); }
            if (C.IsIncluded(target)) Warn(ce, "collection expression into custom type");
        }
        return arr;
    }

    string WithExpr(WithExpressionSyntax w)
    {
        var o = Temp("$w");
        var parts = new List<string> { $"{o} = {Expr(w.Expression)}.$clone()" };
        InitInto(o, w.Initializer, parts);
        parts.Add(o);
        return "(" + string.Join(", ", parts) + ")";
    }

    // ---------------------------------------------------------------- operators
    string Assignment(AssignmentExpressionSyntax a)
    {
        var left = a.Left;
        if (a.IsKind(SyntaxKind.SimpleAssignmentExpression) && Sym(left) is IDiscardSymbol) return Expr(a.Right);
        if (left is ThisExpressionSyntax)
            return a.Right is DefaultExpressionSyntax or LiteralExpressionSyntax { RawKind: (int)SyntaxKind.DefaultLiteralExpression }
                ? $"this.$zero_{C.TypeId(CurType)}()" : $"Object.assign(this, {Expr(a.Right)})";
        if (a.IsKind(SyntaxKind.SimpleAssignmentExpression) && (left is TupleExpressionSyntax || left is DeclarationExpressionSyntax { Designation: ParenthesizedVariableDesignationSyntax }))
        {
            var decon = M.GetDeconstructionInfo(a);
            var target = DeconTarget(left, declare: true);
            if (decon.Method != null) Warn(a, "deconstruct method");
            return $"({target} = {Expr(a.Right)})";
        }
        var lt = M.GetTypeInfo(left).Type;
        var rt = M.GetTypeInfo(a.Right).Type;
        var lsym = Sym(left);
        bool isIndexer = left is ElementAccessExpressionSyntax ea0 && lsym is IPropertySymbol && !Ctx.IsArrayLike(M.GetTypeInfo(ea0.Expression).Type) && M.GetTypeInfo(ea0.Expression).Type is not IArrayTypeSymbol && !Ctx.IsString(M.GetTypeInfo(ea0.Expression).Type);
        bool isBaseProp = left is MemberAccessExpressionSyntax bm && IsBaseRecv(bm.Expression) && lsym is IPropertySymbol;
        string R = Expr(a.Right);
        var backing = AutoPropBacking(left);
        if (backing != null)
        {
            if (a.IsKind(SyntaxKind.SimpleAssignmentExpression)) return $"({backing} = {R})";
            if (a.IsKind(SyntaxKind.CoalesceAssignmentExpression)) return $"({backing} ??= {R})";
        }
        if (a.IsKind(SyntaxKind.SimpleAssignmentExpression))
        {
            if (isIndexer || isBaseProp) return "(" + AssignTo(left, R) + ")";
            return $"({Expr(left)} = {R})";
        }
        if (a.IsKind(SyntaxKind.CoalesceAssignmentExpression))
        {
            if (isIndexer) { var cur = Expr(left); return $"({cur} ?? {AssignTo(left, R)})"; }
            return $"({Expr(left)} ??= {R})";
        }
        var opm = Sym(a) as IMethodSymbol;
        var op = a.Kind() switch
        {
            SyntaxKind.AddAssignmentExpression => "+", SyntaxKind.SubtractAssignmentExpression => "-", SyntaxKind.MultiplyAssignmentExpression => "*",
            SyntaxKind.DivideAssignmentExpression => "/", SyntaxKind.ModuloAssignmentExpression => "%", SyntaxKind.AndAssignmentExpression => "&",
            SyntaxKind.OrAssignmentExpression => "|", SyntaxKind.ExclusiveOrAssignmentExpression => "^", SyntaxKind.LeftShiftAssignmentExpression => "<<",
            SyntaxKind.RightShiftAssignmentExpression => ">>", SyntaxKind.UnsignedRightShiftAssignmentExpression => ">>>", _ => "?",
        };
        var L = Expr(left);
        string value;
        if (lsym is IEventSymbol ev && IsCustomEvent(ev) && (op == "+" || op == "-"))
        {
            // custom add / remove accessors: call them on the receiver (L ends with ".<name>")
            var name = C.MemberName(ev.OriginalDefinition);
            var recv = L.EndsWith("." + name) ? L[..^(name.Length + 1)] : (ev.IsStatic ? TypeRef(ev.ContainingType) : "this");
            return $"{recv}.${(op == "+" ? "add" : "remove")}_{name}({R})";
        }
        if (lsym is IEventSymbol || lt?.TypeKind == TypeKind.Delegate)
            value = op == "+" ? $"$.dcombine({L}, {R})" : $"$.dremove({L}, {R})";
        else if (opm != null && opm.MethodKind == MethodKind.UserDefinedOperator && !Ctx.IsBcl(opm.ContainingType))
        {
            C.UseExt(opm);
            value = $"{TypeRef(opm.ContainingType)}.{C.MethodName(opm)}({L}, {R})";
        }
        else if (lt != null && Ctx.Unnull(lt).SpecialType is SpecialType.System_Int64 or SpecialType.System_UInt64 && op is "&" or "|" or "^" or "<<" or ">>" or ">>>")
            value = $"$.op64(\"{op}\", {L}, {R})";
        else value = ArithOp(op, L, R, lt, lt, rt);
        if (isIndexer || isBaseProp) return "(" + AssignTo(left, value) + ")";
        if (value == $"({L} {op} {R})") return $"({L} {op}= {R})";
        return $"({L} = {value})";
    }

    /// An event declared with its own add / remove accessors (not a field-like event).
    static bool IsCustomEvent(IEventSymbol e) => e.OriginalDefinition.DeclaringSyntaxReferences.Any(r => r.GetSyntax() is EventDeclarationSyntax { AccessorList: not null });

    /// Format string wrapping an int expression into a narrow unsigned/short type, or null for int/long/float.
    static string? NarrowWrap(ITypeSymbol? t) => t == null ? null : Ctx.Unnull(t).SpecialType switch
    {
        SpecialType.System_UInt32 => "(({0}) >>> 0)",
        SpecialType.System_Byte => "(({0}) & 255)",
        SpecialType.System_SByte => "((({0}) << 24) >> 24)",
        SpecialType.System_UInt16 or SpecialType.System_Char => "(({0}) & 65535)",
        SpecialType.System_Int16 => "((({0}) << 16) >> 16)",
        _ => null,
    };

    string ArithOp(string op, string L, string R, ITypeSymbol? resultT, ITypeSymbol? lt, ITypeSymbol? rt)
    {
        if (op == "+" && (Ctx.IsString(lt) || Ctx.IsString(rt) || Ctx.IsString(resultT)))
            return $"({StrOperand(L, lt)} + {StrOperand(R, rt)})";
        if (Ctx.IsDecimal(resultT) && op is "+" or "-" or "*" or "/") return $"$.dm({L} {op} {R})";
        if (op == "/" && Ctx.IsIntLike(lt) && Ctx.IsIntLike(rt) && !Ctx.IsFloat(resultT) && !Ctx.IsDecimal(resultT)) return $"$.idiv({L}, {R})";
        if (resultT?.SpecialType == SpecialType.System_Boolean && op is "&" or "|") return $"!!({L} {op} {R})";
        if (resultT?.SpecialType == SpecialType.System_Boolean && op == "^") return $"({L} !== {R})";
        // unchecked 32-bit integer semantics: uint results wrap (JS bitwise ops are signed), int products use imul
        var rs = resultT == null ? SpecialType.None : Ctx.Unnull(resultT).SpecialType;
        // compound assignment into byte/short/char (binary ops promote to int, so only `x op= y` lands here)
        if (rs is SpecialType.System_Byte or SpecialType.System_SByte or SpecialType.System_Int16 or SpecialType.System_UInt16 or SpecialType.System_Char
            && op is "+" or "-" or "*" or "&" or "|" or "^" or "<<" or ">>")
            return string.Format(NarrowWrap(resultT)!, $"{L} {op} {R}");
        if (rs == SpecialType.System_UInt32 && op is "+" or "-" or "&" or "|" or "^") return $"(({L} {op} {R}) >>> 0)";
        if (rs == SpecialType.System_UInt32 && op == "*") return $"(Math.imul({L}, {R}) >>> 0)";
        if (rs == SpecialType.System_Int32 && op == "*" && Ctx.IsIntLike(lt) && Ctx.IsIntLike(rt)) return $"Math.imul({L}, {R})";
        // float arithmetic rounds to single precision (seeded thresholds like `rng.NextFloat() < chance` compare float32s)
        if (rs == SpecialType.System_Single && op is "+" or "-" or "*" or "/" or "%") return $"Math.fround({L} {op} {R})";
        return $"({L} {op} {R})";
    }

    string StrOperand(string e, ITypeSymbol? t)
    {
        if (t == null) return $"$.str({e})";
        if (Ctx.IsString(t)) return e.StartsWith("\"") || e.StartsWith("(\"") || e.StartsWith("`") || (e.StartsWith("((") && e.Contains(" + ")) || e.StartsWith("$.str(") ? e : $"({e} ?? \"\")";
        if (Ctx.Unnull(t).TypeKind == TypeKind.Enum) return EnumStr(e, Ctx.Unnull(t));
        if (Ctx.IsChar(t)) return $"String.fromCharCode({e})";
        return $"$.str({e})";
    }

    string Binary(BinaryExpressionSyntax b)
    {
        var kind = b.Kind();
        switch (kind)
        {
            case SyntaxKind.LogicalAndExpression: return $"({Expr(b.Left)} && {Expr(b.Right)})";
            case SyntaxKind.LogicalOrExpression: return $"({Expr(b.Left)} || {Expr(b.Right)})";
            case SyntaxKind.CoalesceExpression: return $"({Expr(b.Left)} ?? {Expr(b.Right)})";
            case SyntaxKind.IsExpression:
                {
                    var t = M.GetTypeInfo(b.Right).Type!;
                    var v = Expr(b.Left);
                    return "(" + TypeCheck(v, t) + ")";
                }
            case SyntaxKind.AsExpression:
                {
                    var t = M.GetTypeInfo(b.Right).Type!;
                    var tmp = Temp();
                    return $"(({tmp} = {Expr(b.Left)}), {TypeCheck(tmp, t)} ? {tmp} : null)";
                }
        }
        var lt = M.GetTypeInfo(b.Left).Type;
        var rt = M.GetTypeInfo(b.Right).Type;
        var ltc = M.GetTypeInfo(b.Left).ConvertedType;
        var rtc = M.GetTypeInfo(b.Right).ConvertedType;
        var resT = M.GetTypeInfo(b).Type;
        var L = Expr(b.Left);
        var R = Expr(b.Right);
        var opm = Sym(b) as IMethodSymbol;
        if (opm != null && opm.MethodKind == MethodKind.UserDefinedOperator && !Ctx.IsBcl(opm.ContainingType))
        {
            C.UseExt(opm);
            var call = $"{TypeRef(opm.ContainingType)}.{C.MethodName(opm)}";
            // lifted operator on Nullable<struct> operands: == is true for two nulls, != true for one; others yield false/null
            if ((IsNullableValue(lt) || IsNullableValue(rt)) && !opm.Parameters.Any(p => IsNullableValue(p.Type)))
                return kind switch
                {
                    SyntaxKind.EqualsExpression => $"$.liftEq({L}, {R}, {call})",
                    SyntaxKind.NotEqualsExpression => $"!$.liftEq({L}, {R}, (a, b) => !{call}(a, b))",
                    SyntaxKind.LessThanExpression or SyntaxKind.LessThanOrEqualExpression or SyntaxKind.GreaterThanExpression or SyntaxKind.GreaterThanOrEqualExpression => $"$.lift2({L}, {R}, {call}, false)",
                    _ => $"$.lift2({L}, {R}, {call}, null)",
                };
            return $"{call}({L}, {R})";
        }
        var op = b.OperatorToken.Text;
        var lt64 = Ctx.Unnull(ltc ?? lt ?? rt!).SpecialType is SpecialType.System_Int64 or SpecialType.System_UInt64;
        if (lt64 && kind is SyntaxKind.LeftShiftExpression or SyntaxKind.RightShiftExpression or SyntaxKind.UnsignedRightShiftExpression or SyntaxKind.BitwiseAndExpression or SyntaxKind.BitwiseOrExpression or SyntaxKind.ExclusiveOrExpression)
            return $"$.op64(\"{op}\", {L}, {R})";
        bool lifted = IsNullableValue(lt) || IsNullableValue(rt);
        if (lifted && kind is SyntaxKind.LessThanExpression or SyntaxKind.LessThanOrEqualExpression or SyntaxKind.GreaterThanExpression or SyntaxKind.GreaterThanOrEqualExpression)
            return $"$.lift2({L}, {R}, (a, b) => a {op} b, false)";
        if (lifted && IsNullableValue(resT) && kind is SyntaxKind.AddExpression or SyntaxKind.SubtractExpression or SyntaxKind.MultiplyExpression or SyntaxKind.DivideExpression or SyntaxKind.ModuloExpression or SyntaxKind.BitwiseAndExpression or SyntaxKind.BitwiseOrExpression or SyntaxKind.ExclusiveOrExpression or SyntaxKind.LeftShiftExpression or SyntaxKind.RightShiftExpression)
            return $"$.lift2({L}, {R}, (a, b) => {ArithOp(op, "a", "b", Ctx.Unnull(resT!), Ctx.Unnull(ltc ?? lt!), Ctx.Unnull(rtc ?? rt!))}, null)";
        switch (kind)
        {
            case SyntaxKind.EqualsExpression when (lt as INamedTypeSymbol)?.IsTupleType == true: return $"$.tupleEq({L}, {R})";
            case SyntaxKind.NotEqualsExpression when (lt as INamedTypeSymbol)?.IsTupleType == true: return $"!$.tupleEq({L}, {R})";
            case SyntaxKind.EqualsExpression: return $"({L} == {R})";
            case SyntaxKind.NotEqualsExpression: return $"({L} != {R})";
            case SyntaxKind.AddExpression when resT?.TypeKind == TypeKind.Delegate: return $"$.dcombine({L}, {R})";
            case SyntaxKind.SubtractExpression when resT?.TypeKind == TypeKind.Delegate: return $"$.dremove({L}, {R})";
            case SyntaxKind.AddExpression: case SyntaxKind.SubtractExpression: case SyntaxKind.MultiplyExpression:
            case SyntaxKind.DivideExpression: case SyntaxKind.ModuloExpression: case SyntaxKind.BitwiseAndExpression:
            case SyntaxKind.BitwiseOrExpression: case SyntaxKind.ExclusiveOrExpression:
                return ArithOp(op, L, R, resT, ltc ?? lt, rtc ?? rt);
        }
        return $"({L} {op} {R})";
    }

    static bool IsNullableValue(ITypeSymbol? t) => t is INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T };

    string Prefix(PrefixUnaryExpressionSyntax pu)
    {
        switch (pu.Kind())
        {
            case SyntaxKind.LogicalNotExpression: return $"!{Expr(pu.Operand)}";
            case SyntaxKind.UnaryMinusExpression:
                {
                    var opm = Sym(pu) as IMethodSymbol;
                    if (opm != null && opm.MethodKind == MethodKind.UserDefinedOperator && !Ctx.IsBcl(opm.ContainingType)) { C.UseExt(opm); return $"{TypeRef(opm.ContainingType)}.{C.MethodName(opm)}({Expr(pu.Operand)})"; }
                    return $"(-{Expr(pu.Operand)})";
                }
            case SyntaxKind.UnaryPlusExpression: return $"(+{Expr(pu.Operand)})";
            case SyntaxKind.BitwiseNotExpression: return $"(~{Expr(pu.Operand)})";
            case SyntaxKind.PreIncrementExpression: return IncDec(pu.Operand, "++", prefix: true);
            case SyntaxKind.PreDecrementExpression: return IncDec(pu.Operand, "--", prefix: true);
            case SyntaxKind.IndexExpression: Warn(pu, "standalone ^index"); return $"$.fromEnd({Expr(pu.Operand)})";
            case SyntaxKind.AddressOfExpression: case SyntaxKind.PointerIndirectionExpression: Warn(pu, "pointer"); return Expr(pu.Operand);
        }
        return pu.OperatorToken.Text + Expr(pu.Operand);
    }

    string IncDec(ExpressionSyntax operand, string op, bool prefix)
    {
        var sym = Sym(operand);
        bool isIndexer = operand is ElementAccessExpressionSyntax ea && sym is IPropertySymbol && !Ctx.IsArrayLike(M.GetTypeInfo(ea.Expression).Type) && M.GetTypeInfo(ea.Expression).Type is not IArrayTypeSymbol;
        if (isIndexer)
        {
            var cur = Expr(operand);
            var d = op == "++" ? "+" : "-";
            return "(" + AssignTo(operand, $"{cur} {d} 1") + (prefix ? "" : $" {(d == "+" ? "-" : "+")} 1") + ")";
        }
        var t = Expr(operand);
        // unchecked narrow integers wrap (uint 0 - 1 → uint.MaxValue); JS ++/-- would leave the range
        var wrap = NarrowWrap(M.GetTypeInfo(operand).Type);
        if (wrap != null)
        {
            var dd = op == "++" ? "+" : "-";
            if (prefix) return $"({t} = {string.Format(wrap, $"{t} {dd} 1")})";
            var tmp = Temp();
            return $"(({tmp} = {t}), ({t} = {string.Format(wrap, $"{tmp} {dd} 1")}), {tmp})";
        }
        return prefix ? $"{op}{t}" : $"{t}{op}";
    }

    string Cast(CastExpressionSyntax c)
    {
        var target = M.GetTypeInfo(c.Type).Type;
        var src = M.GetTypeInfo(c.Expression).Type;
        var e = Expr(c.Expression);
        Conversion conv;
        try { conv = M.GetConversion(c); } catch { conv = default; }
        var cm = conv.MethodSymbol;
        if (conv.IsUserDefined && cm != null)
        {
            if (C.IsIncluded(cm.ContainingType)) return $"{C.TypeId(cm.ContainingType)}.{C.MethodName(cm)}({e})";
            C.UseExt(cm);
            return e;
        }
        if (target == null) return e;
        var tt = Ctx.Unnull(target);
        if (Ctx.IsIntLike(tt) && tt.TypeKind != TypeKind.Enum && (Ctx.IsFloat(src) || Ctx.IsDecimal(src)))
            return tt.SpecialType == SpecialType.System_UInt32 ? $"($.trunc({e}) >>> 0)" : $"$.trunc({e})";
        // Integer narrowing / sign changes wrap like C# unchecked casts. Enums count as their underlying type
        // (the decompiler's range idiom `(uint)(kind - 2) <= 1u` subtracts from an enum).
        var st = src is INamedTypeSymbol { TypeKind: TypeKind.Enum } en ? en.EnumUnderlyingType?.SpecialType ?? SpecialType.System_Int32 : src?.SpecialType ?? SpecialType.None;
        bool srcInt = st is SpecialType.System_SByte or SpecialType.System_Byte or SpecialType.System_Int16 or SpecialType.System_UInt16 or SpecialType.System_Int32 or SpecialType.System_UInt32 or SpecialType.System_Int64 or SpecialType.System_UInt64 or SpecialType.System_Char;
        if (srcInt && st != tt.SpecialType && tt.TypeKind != TypeKind.Enum)
            switch (tt.SpecialType)
            {
                case SpecialType.System_UInt32 when st is not (SpecialType.System_Byte or SpecialType.System_UInt16 or SpecialType.System_Char): return $"({e} >>> 0)";
                case SpecialType.System_Int32 when st is SpecialType.System_UInt32 or SpecialType.System_Int64 or SpecialType.System_UInt64: return $"({e} | 0)";
                case SpecialType.System_Byte: return $"({e} & 255)";
                case SpecialType.System_SByte: return $"(({e} << 24) >> 24)";
                case SpecialType.System_UInt16 or SpecialType.System_Char when st is not SpecialType.System_Byte: return $"({e} & 65535)";
                case SpecialType.System_Int16 when st is not (SpecialType.System_Byte or SpecialType.System_SByte): return $"(({e} << 16) >> 16)";
            }
        if (tt.SpecialType == SpecialType.System_Decimal && Ctx.IsFloat(src)) return $"$.dm({e})";
        if (tt.SpecialType == SpecialType.System_Single && src != null && Ctx.Unnull(src).SpecialType != SpecialType.System_Single
            && (Ctx.IsFloat(src) || Ctx.IsDecimal(src) || Ctx.IsIntLike(src))) return $"Math.fround({e})";
        return e;
    }

    // ---------------------------------------------------------------- type checks & patterns
    string TypeCheck(string v, ITypeSymbol t)
    {
        t = Ctx.Unnull(t);
        switch (t.SpecialType)
        {
            case SpecialType.System_String: return $"typeof {v} === \"string\"";
            case SpecialType.System_Boolean: return $"typeof {v} === \"boolean\"";
            case SpecialType.System_Object: return $"{v} != null";
        }
        if (t.TypeKind == TypeKind.Enum || Ctx.IsIntLike(t) || Ctx.IsFloat(t) || Ctx.IsDecimal(t)) return $"typeof {v} === \"number\"";
        if (t.TypeKind == TypeKind.Delegate) return $"typeof {v} === \"function\"";
        if (t is IArrayTypeSymbol || Ctx.IsArrayLike(t))
        {
            // T[] and List<T> are both JS arrays: tell `is int[]` from `is List<SerializableCard>` by the first element
            var el = t is IArrayTypeSymbol at ? at.ElementType : (t as INamedTypeSymbol)?.TypeArguments.FirstOrDefault();
            if (el == null || el.SpecialType == SpecialType.System_Object || el is ITypeParameterSymbol || el.TypeKind == TypeKind.Dynamic)
                return $"Array.isArray({v})";
            return $"$.isArrOf({v}, (x) => {TypeCheck("x", el)})";
        }
        if (t is ITypeParameterSymbol) return $"$.isT({v}, {TypeRef(t)})";
        if (t.TypeKind == TypeKind.Interface) return $"$.isI({v}, {TypeRef(t)})";
        if (t is INamedTypeSymbol n && C.IsIncluded(n)) return $"{v} instanceof {C.TypeId(n)}";
        return $"$.isT({v}, {TypeRef(t)})";
    }

    bool IsSimple(ExpressionSyntax e) =>
        e is ThisExpressionSyntax or LiteralExpressionSyntax
        || (e is IdentifierNameSyntax && Sym(e) is ILocalSymbol or IParameterSymbol { RefKind: RefKind.None });

    string IsPattern(IsPatternExpressionSyntax ip)
    {
        var vt = M.GetTypeInfo(ip.Expression).Type;
        if (IsSimple(ip.Expression)) return "(" + Pat(ip.Pattern, Expr(ip.Expression), vt) + ")";
        var t = Temp();
        return $"(({t} = {Expr(ip.Expression)}), {Pat(ip.Pattern, t, vt)})";
    }

    string Designate(VariableDesignationSyntax? d, string v)
    {
        if (d is SingleVariableDesignationSyntax sv)
        {
            var n = Ctx.SafeLocal(sv.Identifier.ValueText);
            Hoist(n);
            return $"(({n} = {v}), true)";
        }
        return "true";
    }

    string Pat(PatternSyntax p, string v, ITypeSymbol? vt)
    {
        switch (p)
        {
            case ConstantPatternSyntax c:
                if (c.Expression is LiteralExpressionSyntax { RawKind: (int)SyntaxKind.NullLiteralExpression }) return $"{v} == null";
                return $"{v} == {Expr(c.Expression)}";
            case DeclarationPatternSyntax d:
                {
                    var t = M.GetTypeInfo(d.Type).Type!;
                    var chk = TypeCheck(v, t);
                    return d.Designation is SingleVariableDesignationSyntax ? $"({chk} && {Designate(d.Designation, v)})" : chk;
                }
            case VarPatternSyntax vp: return Designate(vp.Designation, v);
            case DiscardPatternSyntax: return "true";
            case TypePatternSyntax tp: return TypeCheck(v, M.GetTypeInfo(tp.Type).Type!);
            case RecursivePatternSyntax r:
                {
                    var parts = new List<string>();
                    ITypeSymbol? st = vt;
                    if (r.Type != null) { st = M.GetTypeInfo(r.Type).Type; parts.Add(TypeCheck(v, st!)); }
                    else parts.Add($"{v} != null");
                    if (r.PositionalPatternClause != null)
                    {
                        int i = 0;
                        foreach (var sub in r.PositionalPatternClause.Subpatterns)
                            parts.Add(Pat(sub.Pattern, $"{v}[{i++}]", null));
                    }
                    if (r.PropertyPatternClause != null)
                        foreach (var sub in r.PropertyPatternClause.Subpatterns)
                        {
                            string target = v;
                            ExpressionSyntax? nameExpr = sub.NameColon?.Name ?? (ExpressionSyntax?)sub.ExpressionColon?.Expression;
                            if (nameExpr != null) target = PropPath(v, nameExpr);
                            parts.Add(Pat(sub.Pattern, target, nameExpr != null ? M.GetTypeInfo(nameExpr).Type : null));
                        }
                    if (r.Designation is SingleVariableDesignationSyntax) parts.Add(Designate(r.Designation, v));
                    return "(" + string.Join(" && ", parts) + ")";
                }
            case RelationalPatternSyntax rp: return $"{v} {rp.OperatorToken.Text} {Expr(rp.Expression)}";
            case BinaryPatternSyntax bp:
                return bp.IsKind(SyntaxKind.AndPattern) ? $"({Pat(bp.Left, v, vt)} && {Pat(bp.Right, v, vt)})" : $"({Pat(bp.Left, v, vt)} || {Pat(bp.Right, v, vt)})";
            case UnaryPatternSyntax up: return $"!({Pat(up.Pattern, v, vt)})";
            case ParenthesizedPatternSyntax pp: return Pat(pp.Pattern, v, vt);
        }
        Warn(p, "unhandled pattern " + p.Kind());
        return "false";
    }

    string PropPath(string v, ExpressionSyntax nameExpr)
    {
        switch (nameExpr)
        {
            case IdentifierNameSyntax id:
                {
                    var s = Sym(id);
                    return s != null ? MemberOn(v, s, s.ContainingType, id, false) : $"{v}.{id.Identifier.ValueText}";
                }
            case MemberAccessExpressionSyntax ma:
                {
                    var left = PropPath(v, ma.Expression);
                    var s = Sym(ma);
                    return s != null ? MemberOn(left, s, s.ContainingType, ma, false) : $"{left}.{ma.Name.Identifier.ValueText}";
                }
        }
        return v;
    }

    string SwitchExpr(SwitchExpressionSyntax se)
    {
        var vt = M.GetTypeInfo(se.GoverningExpression).Type;
        var t = Temp("$s");
        var acc = $"$.throwSwitch({t})";
        foreach (var arm in se.Arms.Reverse())
        {
            var cond = Pat(arm.Pattern, t, vt);
            if (arm.WhenClause != null) cond = $"{cond} && {Cond(arm.WhenClause.Condition)}";
            var val = Expr(arm.Expression);
            acc = cond == "true" ? val : $"({cond} ? {val} : {acc})";
        }
        return $"({t} = {Expr(se.GoverningExpression)}, {acc})";
    }

    /// Deconstruction target: `var (a, b)` / `(a, b)` / `(var a, _)` → `[a, b]` (declares via hoisting).
    string DeconTarget(ExpressionSyntax e, bool declare)
    {
        switch (e)
        {
            case DeclarationExpressionSyntax d: return Designation(d.Designation);
            case TupleExpressionSyntax t: return "[" + string.Join(", ", t.Arguments.Select(a => DeconTarget(a.Expression, declare))) + "]";
            case IdentifierNameSyntax { Identifier.ValueText: "_" } when Sym(e) is IDiscardSymbol or null: return "";
            default: return Expr(e);
        }
    }

    string Designation(VariableDesignationSyntax d)
    {
        switch (d)
        {
            case SingleVariableDesignationSyntax s: { var n = Ctx.SafeLocal(s.Identifier.ValueText); Hoist(n); return n; }
            case DiscardDesignationSyntax: return "";
            case ParenthesizedVariableDesignationSyntax p: return "[" + string.Join(", ", p.Variables.Select(Designation)) + "]";
        }
        return "";
    }

    // ---------------------------------------------------------------- lambdas
    string Lambda(AnonymousFunctionExpressionSyntax lam)
    {
        var sym = M.GetSymbolInfo(lam).Symbol as IMethodSymbol;
        var ps = new List<string>();
        int discard = 0;
        if (sym != null)
            foreach (var p in sym.Parameters)
            {
                var n = p.Name == "_" || p.IsDiscard ? "_" + (++discard) : Ctx.SafeLocal(p.Name);
                if (p.RefKind is RefKind.Out or RefKind.Ref) symOverride[p] = n + ".v";
                ps.Add(n);
            }
        var isAsync = lam.AsyncKeyword.RawKind != 0;
        var retT = sym?.ReturnType;
        var isStatic = F.Static;
        var body = lam.Body;
        var head = "(" + string.Join(", ", ps) + ")";
        if (isAsync)
        {
            var inner = body is BlockSyntax bb ? FnBody(bb, null, isStatic, gen: true, retType: retT != null ? AsyncResultType(retT) : null)
                                               : FnBodyExpr((ExpressionSyntax)body, isStatic, gen: true, retT != null ? AsyncResultType(retT) : null, isVoid: retT == null || IsVoidAsync(retT));
            return $"({head} => $.async(function* () {{\n{Indent(inner)}}}, this))";
        }
        if (body is BlockSyntax b) return $"({head} => {{\n{Indent(FnBody(b, null, isStatic, gen: false, retType: retT, isVoid: sym?.ReturnsVoid ?? false))}}})";
        var fn = new Fn { Gen = false, Static = isStatic };
        var text = WithFn(fn, () => Expr((ExpressionSyntax)body));
        if (fn.Hoisted.Count > 0 || text.StartsWith("let "))
        {
            var lines = text.Split('\n', 2);
            return sym?.ReturnsVoid == true ? $"({head} => {{ {lines[0]} {lines[1]}; }})" : $"({head} => {{ {lines[0]} return {lines[1]}; }})";
        }
        if (text.StartsWith("{")) text = $"({text})";
        return $"({head} => {text})";
    }

    // ---------------------------------------------------------------- interpolation
    string Interp(InterpolatedStringExpressionSyntax i)
    {
        var sb = new StringBuilder("`");
        foreach (var c in i.Contents)
        {
            if (c is InterpolatedStringTextSyntax t) sb.Append(t.TextToken.ValueText.Replace("\\", "\\\\").Replace("`", "\\`").Replace("${", "\\${"));
            else if (c is InterpolationSyntax x)
            {
                var e = Expr(x.Expression);
                var t2 = M.GetTypeInfo(x.Expression).Type;
                if (x.FormatClause != null || x.AlignmentClause != null)
                    sb.Append($"${{$.fmt({e}, {(x.FormatClause != null ? Q(x.FormatClause.FormatStringToken.ValueText) : "null")}, {(x.AlignmentClause != null ? Expr(x.AlignmentClause.Value) : "0")})}}");
                else sb.Append("${" + StrOperand(e, t2) + "}");
            }
        }
        return sb.Append('`').ToString();
    }

    // ---------------------------------------------------------------- queries
    int qDepth;
    string Query(QueryExpressionSyntax q)
    {
        var from = q.FromClause;
        var src = Expr(from.Expression);
        var enumerable = LinqAlias();
        if (from.Type != null) src = $"{enumerable}.Cast({TypeRef(M.GetTypeInfo(from.Type).Type!)}, {src})";
        var v = (IRangeVariableSymbol)M.GetDeclaredSymbol(from)!;
        return QueryBody(q.Body, src, new List<IRangeVariableSymbol> { v });
    }

    string LinqAlias()
    {
        var t = C.Comp.GetTypeByMetadataName("System.Linq.Enumerable")!;
        return C.ExtAlias(t);
    }

    string QLam(List<IRangeVariableSymbol> vars, Func<string> body)
    {
        string param;
        var saved = vars.ToDictionary(v => (ISymbol)v, v => symOverride.GetValueOrDefault(v), Ctx.SE);
        if (vars.Count == 1) { param = Ctx.SafeLocal(vars[0].Name); symOverride[vars[0]] = param; }
        else { param = "$q" + (++qDepth); foreach (var v in vars) symOverride[v] = $"{param}.{Ctx.SafeLocal(v.Name)}"; }
        var fn = new Fn { Gen = false, Static = F.Static };
        var text = WithFn(fn, body);
        foreach (var kv in saved) { if (kv.Value == null) symOverride.Remove(kv.Key); else symOverride[kv.Key] = kv.Value; }
        if (text.StartsWith("let "))
        {
            var lines = text.Split('\n', 2);
            return $"(({param}) => {{ {lines[0]} return {lines[1]}; }})";
        }
        return $"(({param}) => {text})";
    }

    string QObj(List<IRangeVariableSymbol> vars, string? extraName = null, string? extraVal = null)
    {
        var fields = vars.Select(v => $"{Ctx.SafeLocal(v.Name)}: {symOverride[v]}").ToList();
        if (extraName != null) fields.Add($"{extraName}: {extraVal}");
        return "({ " + string.Join(", ", fields) + " })";
    }

    string QueryBody(QueryBodySyntax body, string src, List<IRangeVariableSymbol> vars)
    {
        var E = LinqAlias();
        var cur = src;
        foreach (var clause in body.Clauses)
        {
            switch (clause)
            {
                case FromClauseSyntax f:
                    {
                        var nv = (IRangeVariableSymbol)M.GetDeclaredSymbol(f)!;
                        var coll = QLam(vars, () => Expr(f.Expression));
                        var all = vars.Append(nv).ToList();
                        var sel = "((" + string.Join(", ", vars.Count == 1 ? new[] { "$a" } : new[] { "$a" }) + ", $b) => ({ " + string.Join(", ", vars.Select(v => $"{Ctx.SafeLocal(v.Name)}: {(vars.Count == 1 ? "$a" : "$a." + Ctx.SafeLocal(v.Name))}")) + $", {Ctx.SafeLocal(nv.Name)}: $b }}))";
                        cur = $"{E}.SelectMany({cur}, {coll}, {sel})";
                        vars = all;
                        break;
                    }
                case LetClauseSyntax l:
                    {
                        var nv = (IRangeVariableSymbol)M.GetDeclaredSymbol(l)!;
                        cur = $"{E}.Select({cur}, {QLam(vars, () => QObj(vars, Ctx.SafeLocal(nv.Name), Expr(l.Expression)))})";
                        vars = vars.Append(nv).ToList();
                        break;
                    }
                case WhereClauseSyntax w:
                    cur = $"{E}.Where({cur}, {QLam(vars, () => Expr(w.Condition))})";
                    break;
                case OrderByClauseSyntax o:
                    for (int i = 0; i < o.Orderings.Count; i++)
                    {
                        var ord = o.Orderings[i];
                        var desc = ord.AscendingOrDescendingKeyword.IsKind(SyntaxKind.DescendingKeyword);
                        var mname = i == 0 ? (desc ? "OrderByDescending" : "OrderBy") : (desc ? "ThenByDescending" : "ThenBy");
                        cur = $"{E}.{mname}({cur}, {QLam(vars, () => Expr(ord.Expression))})";
                    }
                    break;
                default:
                    Warn(clause, "query clause " + clause.Kind());
                    break;
            }
        }
        switch (body.SelectOrGroup)
        {
            case SelectClauseSyntax s:
                if (vars.Count == 1 && s.Expression is IdentifierNameSyntax id && id.Identifier.ValueText == vars[0].Name) break;
                cur = $"{E}.Select({cur}, {QLam(vars, () => Expr(s.Expression))})";
                break;
            case GroupClauseSyntax g:
                cur = $"{E}.GroupBy({cur}, {QLam(vars, () => Expr(g.ByExpression))}, {QLam(vars, () => Expr(g.GroupExpression))})";
                break;
        }
        if (body.Continuation != null)
        {
            var nv = (IRangeVariableSymbol)M.GetDeclaredSymbol(body.Continuation)!;
            return QueryBody(body.Continuation.Body, cur, new List<IRangeVariableSymbol> { nv });
        }
        return cur;
    }

    /// Owner expression for static member access (string.Join, int.MaxValue → runtime BCL objects, not type markers).
    string StaticOwner(ITypeSymbol t) => t is INamedTypeSymbol n && !C.IsIncluded(n) && !n.IsAnonymousType ? C.ExtAlias(n) : TypeRef(t);

    // ---------------------------------------------------------------- types as runtime values
    public string TypeRef(ITypeSymbol t)
    {
        switch (t)
        {
            case ITypeParameterSymbol tp:
                if (tp.TypeParameterKind == TypeParameterKind.Method) return RtTypeParam(tp);
                return F.Static ? $"$.unknownTypeParam(\"{tp.Name}\")" : $"this.$T_{Ctx.CleanName(tp.Name)}";
            case IArrayTypeSymbol: return "Array";
            case IErrorTypeSymbol: return "undefined";
            case INamedTypeSymbol n:
                if (n.IsTupleType) return "Array";
                if (n.OriginalDefinition.SpecialType == SpecialType.System_Nullable_T) return TypeRef(n.TypeArguments[0]);
                switch (n.SpecialType)
                {
                    case SpecialType.System_String: return "$.T.String";
                    case SpecialType.System_Boolean: return "$.T.Boolean";
                    case SpecialType.System_Int32: return "$.T.Int32";
                    case SpecialType.System_Int64: return "$.T.Int64";
                    case SpecialType.System_UInt32: return "$.T.UInt32";
                    case SpecialType.System_UInt64: return "$.T.UInt64";
                    case SpecialType.System_Single: return "$.T.Single";
                    case SpecialType.System_Double: return "$.T.Double";
                    case SpecialType.System_Decimal: return "$.T.Decimal";
                    case SpecialType.System_Char: return "$.T.Char";
                    case SpecialType.System_Byte: return "$.T.Byte";
                    case SpecialType.System_Object: return "$.T.Object";
                }
                if (Ctx.IsArrayLike(n)) return "Array";
                if (C.IsIncluded(n)) return C.TypeId(n);
                if (n.IsAnonymousType) return "Object";
                return C.ExtAlias(n);
        }
        return "undefined";
    }
}
