using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

public partial class Emitter
{
    // Break/continue resolution. Kinds: L = loop, S = native switch, P = pattern switch (labeled block), M = goto state machine.
    sealed class Construct { public char Kind; public string Label = ""; public bool Used; }
    readonly List<Construct> constructs = new();
    static int labelSeq;
    Construct PushC(char kind, string? label = null) { var c = new Construct { Kind = kind, Label = label ?? "$lp" + (++labelSeq) }; constructs.Add(c); return c; }
    void PopC() => constructs.RemoveAt(constructs.Count - 1);
    string Labeled(Construct c, string code) => c.Used ? $"{c.Label}: {code}" : code;
    string BreakText()
    {
        bool crossed = false;
        for (int i = constructs.Count - 1; i >= 0; i--)
        {
            var c = constructs[i];
            if (c.Kind == 'M') { crossed = true; continue; }
            if (c.Kind == 'P') { c.Used = true; return $"break {c.Label};\n"; }
            if (!crossed) return "break;\n";
            c.Used = true;
            return $"break {c.Label};\n";
        }
        return "break;\n";
    }
    string ContinueText()
    {
        bool crossed = false;
        for (int i = constructs.Count - 1; i >= 0; i--)
        {
            var c = constructs[i];
            if (c.Kind == 'M') { crossed = true; continue; }
            if (c.Kind != 'L') continue;
            if (!crossed) return "continue;\n";
            c.Used = true;
            return $"continue {c.Label};\n";
        }
        return "continue;\n";
    }
    readonly Dictionary<string, (string loop, string state, int idx)> gotoTargets = new();
    static int gotoSeq;
    readonly HashSet<VariableDeclaratorSyntax> declAsAssign = new();

    string StmtListText(IReadOnlyList<StatementSyntax> list)
    {
        var sb = new StringBuilder();
        StmtList(list, sb);
        return sb.ToString();
    }

    void StmtList(IReadOnlyList<StatementSyntax> list, StringBuilder o)
    {
        foreach (var lf in list.OfType<LocalFunctionStatementSyntax>()) o.Append(LocalFunction(lf));
        var stmts = list.Where(s => s is not LocalFunctionStatementSyntax).ToList();
        if (stmts.Any(s => s is LabeledStatementSyntax)) { GotoList(stmts, o); return; }
        for (int i = 0; i < stmts.Count; i++)
        {
            var s = stmts[i];
            if (s is LocalDeclarationStatementSyntax { UsingKeyword.RawKind: not 0 } uds)
            {
                o.Append(LocalDecl(uds.Declaration, false));
                var rest = new StringBuilder();
                StmtList(stmts.Skip(i + 1).ToList(), rest);
                var disposes = string.Concat(uds.Declaration.Variables.Reverse().Select(v => DisposeCall(Ctx.SafeLocal(v.Identifier.ValueText), uds.AwaitKeyword.RawKind != 0)));
                o.Append($"try {{\n{Indent(rest.ToString())}}} finally {{\n{disposes}}}\n");
                return;
            }
            Stmt(s, o);
        }
    }

    /// `using` disposal; `await using` awaits IAsyncDisposable.DisposeAsync (the generator's yield is the await).
    static string DisposeCall(string v, bool isAwait) => isAwait
        ? $"  if ({v} != null) yield (typeof {v}.DisposeAsync === \"function\" ? {v}.DisposeAsync() : {v}.Dispose?.());\n"
        : $"  {v}?.Dispose?.();\n";

    /// C# goto (ILSpy spaghetti, forward and backward) → `for(;;) switch(state)` state machine over the statement list.
    void GotoList(List<StatementSyntax> stmts, StringBuilder o)
    {
        var names = new List<string>();
        foreach (var s in stmts)
        {
            var inner = s;
            while (inner is LabeledStatementSyntax ls0) inner = ls0.Statement;
            if (inner is LocalDeclarationStatementSyntax ld)
                foreach (var v in ld.Declaration.Variables) { names.Add(Ctx.SafeLocal(v.Identifier.ValueText)); declAsAssign.Add(v); }
        }
        var segs = new List<(string? label, List<StatementSyntax> body)> { (null, new List<StatementSyntax>()) };
        foreach (var s in stmts)
        {
            var cur = s;
            while (cur is LabeledStatementSyntax ls) { segs.Add((ls.Identifier.ValueText, new List<StatementSyntax>())); cur = ls.Statement; }
            segs[^1].body.Add(cur);
        }
        var id = ++gotoSeq;
        var loop = "$g" + id; var state = "$L" + id;
        for (int i = 1; i < segs.Count; i++) gotoTargets[segs[i].label!] = (loop, state, i);
        if (names.Count > 0) o.Append($"let {string.Join(", ", names.Distinct())};\n");
        o.Append($"let {state} = 0;\n{loop}: for (;;) {{\n  switch ({state}) {{\n");
        PushC('M');
        for (int i = 0; i < segs.Count; i++)
        {
            o.Append($"    case {i}:\n");
            o.Append(Indent(StmtListText(segs[i].body), 3));
        }
        PopC();
        o.Append("  }\n  break;\n}\n");
    }

    string Embedded(StatementSyntax s)
    {
        if (s is BlockSyntax b) return "{\n" + Indent(StmtListText(b.Statements)) + "}\n";
        var sb = new StringBuilder();
        Stmt(s, sb);
        return "{\n" + Indent(sb.ToString()) + "}\n";
    }

    string Cond(ExpressionSyntax e) => StripParens(Expr(e));
    static string StripParens(string s)
    {
        if (s.Length < 2 || s[0] != '(' || s[^1] != ')') return s;
        int depth = 0;
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] == '(') depth++;
            else if (s[i] == ')') { depth--; if (depth == 0 && i < s.Length - 1) return s; }
        }
        return s[1..^1];
    }

    void Stmt(StatementSyntax s, StringBuilder o)
    {
        switch (s)
        {
            case BlockSyntax b:
                o.Append("{\n" + Indent(StmtListText(b.Statements)) + "}\n");
                break;
            case LocalDeclarationStatementSyntax ld:
                o.Append(LocalDecl(ld.Declaration, ld.IsConst));
                break;
            case ExpressionStatementSyntax es:
                o.Append(StripParens(Expr(es.Expression)) is var x && x.StartsWith("{") ? $"({x});\n" : x + ";\n");
                break;
            case IfStatementSyntax ifs:
                o.Append($"if ({Cond(ifs.Condition)}) " + Embedded(ifs.Statement).TrimEnd('\n'));
                if (ifs.Else != null)
                {
                    if (ifs.Else.Statement is IfStatementSyntax elif)
                    {
                        var sb = new StringBuilder();
                        Stmt(elif, sb);
                        o.Append(" else " + sb);
                    }
                    else o.Append(" else " + Embedded(ifs.Else.Statement));
                }
                else o.Append("\n");
                break;
            case WhileStatementSyntax w:
                {
                    var c = PushC('L');
                    var code = $"while ({Cond(w.Condition)}) " + Embedded(w.Statement);
                    PopC();
                    o.Append(Labeled(c, code));
                    break;
                }
            case DoStatementSyntax d:
                {
                    var c = PushC('L');
                    var code = "do " + Embedded(d.Statement).TrimEnd('\n') + $" while ({Cond(d.Condition)});\n";
                    PopC();
                    o.Append(Labeled(c, code));
                    break;
                }
            case ForStatementSyntax f:
                {
                    var c = PushC('L');
                    var init = f.Declaration != null ? LocalDecl(f.Declaration, false).TrimEnd('\n', ';') : string.Join(", ", f.Initializers.Select(Expr));
                    var cond = f.Condition != null ? Cond(f.Condition) : "";
                    var inc = string.Join(", ", f.Incrementors.Select(x => StripParens(Expr(x))));
                    var code = $"for ({init}; {cond}; {inc}) " + Embedded(f.Statement);
                    PopC();
                    o.Append(Labeled(c, code));
                    break;
                }
            case ForEachStatementSyntax fe:
                {
                    var ct = M.GetTypeInfo(fe.Expression).Type;
                    var src = Iter(Expr(fe.Expression), ct);
                    var c = PushC('L');
                    var code = $"for (const {Ctx.SafeLocal(fe.Identifier.ValueText)} of {src}) " + Embedded(fe.Statement);
                    PopC();
                    o.Append(Labeled(c, code));
                    break;
                }
            case ForEachVariableStatementSyntax fev:
                {
                    var ct = M.GetTypeInfo(fev.Expression).Type;
                    var src = Iter(Expr(fev.Expression), ct);
                    var target = DeconTarget(fev.Variable, declare: false);
                    var c = PushC('L');
                    var code = $"for (const {target} of {src}) " + Embedded(fev.Statement);
                    PopC();
                    o.Append(Labeled(c, code));
                    break;
                }
            case ReturnStatementSyntax r:
                if (r.Expression == null) o.Append(F.Ctor ? "return this;\n" : "return;\n");
                else o.Append($"return {Expr(r.Expression)};\n");
                break;
            case YieldStatementSyntax y:
                o.Append(y.IsKind(SyntaxKind.YieldBreakStatement) ? "return;\n" : $"yield {Expr(y.Expression!)};\n");
                break;
            case BreakStatementSyntax:
                o.Append(BreakText());
                break;
            case ContinueStatementSyntax:
                o.Append(ContinueText());
                break;
            case GotoStatementSyntax g:
                if (g.IsKind(SyntaxKind.GotoStatement) && gotoTargets.TryGetValue(((IdentifierNameSyntax)g.Expression!).Identifier.ValueText, out var gt))
                    o.Append($"{{ {gt.state} = {gt.idx}; continue {gt.loop}; }}\n");
                else { Warn(g, "goto without target"); o.Append("/* goto */ break;\n"); }
                break;
            case ThrowStatementSyntax t:
                o.Append(t.Expression != null ? $"throw {Expr(t.Expression)};\n" : $"throw {F.CatchVar ?? "$.rethrowMissing()"};\n");
                break;
            case TryStatementSyntax t:
                TryStmt(t, o);
                break;
            case UsingStatementSyntax u:
                {
                    var body = Embedded(u.Statement);
                    if (u.Declaration != null)
                    {
                        var decl = LocalDecl(u.Declaration, false);
                        var disposes = string.Concat(u.Declaration.Variables.Reverse().Select(v => DisposeCall(Ctx.SafeLocal(v.Identifier.ValueText), u.AwaitKeyword.RawKind != 0)));
                        o.Append($"{{\n{Indent(decl)}  try {body.TrimEnd('\n')} finally {{\n{Indent(disposes)}  }}\n}}\n");
                    }
                    else
                    {
                        var tmp = Temp("$u");
                        o.Append($"{tmp} = {Expr(u.Expression!)};\ntry {body.TrimEnd('\n')} finally {{\n{DisposeCall(tmp, u.AwaitKeyword.RawKind != 0)}}}\n");
                    }
                    break;
                }
            case LockStatementSyntax l:
                o.Append(Embedded(l.Statement));
                break;
            case SwitchStatementSyntax sw:
                SwitchStmt(sw, o);
                break;
            case CheckedStatementSyntax c:
                o.Append(Embedded(c.Block));
                break;
            case UnsafeStatementSyntax u:
                o.Append(Embedded(u.Block));
                break;
            case EmptyStatementSyntax:
                break;
            case LabeledStatementSyntax l:
                o.Append($"{l.Identifier.ValueText}: ");
                Stmt(l.Statement, o);
                break;
            case LocalFunctionStatementSyntax lf:
                o.Append(LocalFunction(lf));
                break;
            default:
                Warn(s, "unhandled statement " + s.Kind());
                o.Append($"/* TODO stmt {s.Kind()} */\n");
                break;
        }
    }

    string Iter(string e, ITypeSymbol? t)
    {
        if (t != null && (Ctx.IsArrayLike(t) || t is IArrayTypeSymbol)) return e;
        if (Ctx.IsString(t)) return $"$.chars({e})";
        return $"$.iter({e})";
    }

    string LocalDecl(VariableDeclarationSyntax d, bool isConst)
    {
        var parts = new List<string>();
        var assigns = new List<string>();
        var type = M.GetTypeInfo(d.Type).Type;
        foreach (var v in d.Variables)
        {
            var name = Ctx.SafeLocal(v.Identifier.ValueText);
            var sym = M.GetDeclaredSymbol(v) as ILocalSymbol;
            var t = sym?.Type ?? type;
            string? init = v.Initializer != null ? ExprIn(v.Initializer.Value, t) : (t != null && t.IsValueType && C.IsIncluded(t) ? DefaultOf(t) : null);
            if (declAsAssign.Contains(v)) { if (init != null) assigns.Add($"{name} = {init}"); continue; }
            parts.Add(init != null ? $"{name} = {init}" : name);
        }
        if (parts.Count == 0) return assigns.Count > 0 ? string.Join(", ", assigns) + ";\n" : "";
        var kw = isConst ? "const" : "let";
        var res = $"{kw} {string.Join(", ", parts)};\n";
        if (assigns.Count > 0) res += string.Join(", ", assigns) + ";\n";
        return res;
    }

    string LocalFunction(LocalFunctionStatementSyntax lf)
    {
        var m = (IMethodSymbol)M.GetDeclaredSymbol(lf)!;
        var name = Ctx.SafeLocal(lf.Identifier.ValueText);
        var ps = Params(m.Parameters, m.TypeParameters);
        var isIter = IsIterator((SyntaxNode?)lf.Body ?? lf.ExpressionBody!);
        var isStatic = F.Static;
        string body;
        if (m.IsAsync) body = $"$.async(function* () {{\n{Indent(FnBody(lf.Body, lf.ExpressionBody, isStatic, gen: true, retType: AsyncResultType(m.ReturnType), isVoid: IsVoidAsync(m.ReturnType)))}}}, this)";
        else if (isIter) body = $"$.seq(function* () {{\n{Indent(FnBody(lf.Body, lf.ExpressionBody, isStatic, gen: true, iter: true))}}}, this)";
        else return $"const {name} = ({ps}) => {{\n{Indent(FnBody(lf.Body, lf.ExpressionBody, isStatic, gen: false, retType: m.ReturnType, isVoid: m.ReturnsVoid))}}};\n";
        return $"const {name} = ({ps}) => {body};\n";
    }

    static int catchSeq;
    void TryStmt(TryStatementSyntax t, StringBuilder o)
    {
        o.Append("try " + Embedded(t.Block).TrimEnd('\n'));
        if (t.Catches.Count > 0)
        {
            var ev = "$e" + (++catchSeq);
            var prev = F.CatchVar;
            F.CatchVar = ev;
            var sb = new StringBuilder();
            var declared = new HashSet<string>();
            foreach (var c in t.Catches)
                if (c.Declaration != null && c.Declaration.Identifier.ValueText is { Length: > 0 } n && declared.Add(Ctx.SafeLocal(n)))
                    sb.Append($"let {Ctx.SafeLocal(n)} = {ev};\n");
            var chain = new StringBuilder();
            bool unconditional = false;
            for (int i = 0; i < t.Catches.Count; i++)
            {
                var c = t.Catches[i];
                var conds = new List<string>();
                if (c.Declaration != null)
                {
                    var ct = M.GetTypeInfo(c.Declaration.Type).Type;
                    if (ct != null && ct.ToDisplayString() is not ("System.Exception" or "object")) conds.Add($"$.isEx({ev}, {TypeRef(ct)})");
                }
                if (c.Filter != null) conds.Add("(" + Cond(c.Filter.FilterExpression) + ")");
                var body = Embedded(c.Block).TrimEnd('\n');
                if (conds.Count == 0)
                {
                    chain.Append(i == 0 ? body + "\n" : $" else {body}\n");
                    unconditional = true;
                    break;
                }
                chain.Append((i == 0 ? "" : " else ") + $"if ({string.Join(" && ", conds)}) {body}");
            }
            if (!unconditional) chain.Append($" else {{\n  throw {ev};\n}}\n");
            sb.Append(chain);
            o.Append($" catch ({ev}) {{\n{Indent(sb.ToString())}}}");
            F.CatchVar = prev;
        }
        if (t.Finally != null) o.Append(" finally " + Embedded(t.Finally.Block).TrimEnd('\n'));
        o.Append("\n");
    }

    static int swSeq;
    void SwitchStmt(SwitchStatementSyntax sw, StringBuilder o)
    {
        var gt = M.GetTypeInfo(sw.Expression).Type;
        bool simple = sw.Sections.All(sec => sec.Labels.All(l => l is DefaultSwitchLabelSyntax || (l is CaseSwitchLabelSyntax cl && M.GetConstantValue(cl.Value).HasValue)));
        if (simple)
        {
            var sc = PushC('S');
            var sb = new StringBuilder();
            foreach (var sec in sw.Sections)
            {
                foreach (var l in sec.Labels)
                    sb.Append(l is CaseSwitchLabelSyntax cl ? $"case {CaseConst(cl.Value, gt)}:\n" : "default:\n");
                sb.Append(Indent(StmtListText(sec.Statements)));
            }
            PopC();
            o.Append(Labeled(sc, $"switch ({Cond(sw.Expression)}) {{\n{Indent(sb.ToString())}}}\n"));
            return;
        }
        var lbl = "$sw" + (++swSeq);
        var tmp = Temp("$s");
        o.Append($"{tmp} = {Expr(sw.Expression)};\n");
        PushC('P', lbl);
        var chain = new StringBuilder();
        SwitchSectionSyntax? def = null;
        bool first = true;
        foreach (var sec in sw.Sections)
        {
            var conds = new List<string>();
            foreach (var l in sec.Labels)
            {
                switch (l)
                {
                    case DefaultSwitchLabelSyntax: def = sec; break;
                    case CaseSwitchLabelSyntax cl: conds.Add($"{tmp} == {CaseConst(cl.Value, gt)}"); break;
                    case CasePatternSwitchLabelSyntax pl:
                        var pc = Pat(pl.Pattern, tmp, gt);
                        if (pl.WhenClause != null) pc = $"({pc} && {Cond(pl.WhenClause.Condition)})";
                        conds.Add(pc);
                        break;
                }
            }
            if (conds.Count == 0) continue;
            var body = "{\n" + Indent(StmtListText(sec.Statements)) + "}";
            chain.Append((first ? "" : " else ") + $"if ({string.Join(" || ", conds)}) {body}");
            first = false;
        }
        if (def != null)
        {
            var body = "{\n" + Indent(StmtListText(def.Statements)) + "}";
            chain.Append(first ? body : $" else {body}");
        }
        PopC();
        o.Append($"{lbl}: {{\n{Indent(chain.ToString())}}}\n");
    }

    string CaseConst(ExpressionSyntax v, ITypeSymbol? gt)
    {
        var cv = M.GetConstantValue(v);
        if (cv.HasValue && v is not MemberAccessExpressionSyntax && v is not IdentifierNameSyntax) return ConstLit(cv.Value, gt);
        return Expr(v);
    }
}
