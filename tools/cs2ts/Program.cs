using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

// cs2ts: transpile the decompiled Slay the Spire 2 rule layer (C#) into one TypeScript module.
// usage: dotnet run -c Release -- <decompiledRoot> <outDir>
var root = Path.GetFullPath(args.Length > 0 ? args[0] : "../../ref/decompiled");
var outDir = Path.GetFullPath(args.Length > 1 ? args[1] : "../../packages/core/src/gen");
var refDir = "/Applications/SlayTheSpire2.app/Contents/Game/SlayTheSpire2.app/Contents/Resources/data_sts2_macos_arm64";
Directory.CreateDirectory(outDir);
var sw = System.Diagnostics.Stopwatch.StartNew();

// Extra source roots transpiled alongside the game (third-party libraries the rule layer needs verbatim).
var extraRoots = new[] { Path.GetFullPath(Path.Combine(root, "../smartformat")) }.ToList();
foreach (var r in extraRoots.Where(r => !Directory.Exists(r)))
{
    Console.Error.WriteLine($"missing {r}: decompile SmartFormat.dll first (tools/decompile.sh)");
    Environment.Exit(1);
}
var files = Directory.GetFiles(root, "*.cs", SearchOption.AllDirectories)
    .Concat(extraRoots.SelectMany(r => Directory.GetFiles(r, "*.cs", SearchOption.AllDirectories).Where(f => !f.Contains("/Properties/")))).ToArray();
var opts = new CSharpParseOptions(LanguageVersion.Preview);
// Source patches for ILSpy artifacts that do not round-trip through Roslyn.
string Patch(string path, string text)
{
    // ILSpy renders `a?.B().Where(t => c).ToList() ?? fallback` as `(from t in a?.B() where c select t).ToList() ?? fallback`,
    // which no longer short-circuits (Where(null) throws). Restore the method chain so the whole chain is null-conditional.
    if (text.Contains("?.") && text.Contains("from "))
        text = Regex.Replace(text, @"\(from (\w+) in ([^\n]*?\?\.[^\n]*?)\s*\n\s*where ([^\n]+?)\s*\n\s*select \1\)\.",
            m => $"{m.Groups[2].Value}.Where({m.Groups[1].Value} => {m.Groups[3].Value}).");
    if (text.Contains("Swift") && path.Contains("/Models/") && !path.EndsWith("/Swift.cs"))
        text = Regex.Replace(text, @"(?<![\w.""])Swift(?![\w""])", "global::MegaCrit.Sts2.Core.Models.Enchantments.Swift");
    return text;
}
var trees = files.AsParallel().Select(f => CSharpSyntaxTree.ParseText(Patch(f.Replace('\\', '/'), File.ReadAllText(f)), opts, f)).ToList();
var refs = Directory.GetFiles(refDir, "*.dll").Where(p => !p.EndsWith("/sts2.dll") && !(extraRoots.Count > 0 && p.EndsWith("/SmartFormat.dll")))
    .Select(p => { try { return (MetadataReference)MetadataReference.CreateFromFile(p); } catch { return null; } }).Where(r => r != null).ToList();
var comp = CSharpCompilation.Create("sts2", trees, refs!, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: true, nullableContextOptions: NullableContextOptions.Enable));
var ctx = new Ctx { Comp = comp };
if (Environment.GetEnvironmentVariable("CS2TS_DIAG") is { Length: > 0 } diagFilter)
    foreach (var tr in trees.Where(t => t.FilePath.Contains(diagFilter)))
        foreach (var d in comp.GetSemanticModel(tr).GetDiagnostics().Where(d => d.Severity == DiagnosticSeverity.Error).Take(20))
            Console.WriteLine(d.ToString());
Console.WriteLine($"parsed {files.Length} files in {sw.ElapsedMilliseconds}ms");

// ------------------------------------------------------------------ original metadata: which types are beforefieldinit (lazy type init)
foreach (var dll in new[] { Path.Combine(refDir, "sts2.dll"), Path.Combine(refDir, "SmartFormat.dll") })
{
    using var pe = new System.Reflection.PortableExecutable.PEReader(File.OpenRead(dll));
    var md = System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(pe);
    foreach (var h in md.TypeDefinitions)
    {
        var td = md.GetTypeDefinition(h);
        if ((td.Attributes & System.Reflection.TypeAttributes.BeforeFieldInit) == 0) continue;
        string Name(System.Reflection.Metadata.TypeDefinition d)
        {
            var dh = d.GetDeclaringType();
            var n = md.GetString(d.Name);
            return dh.IsNil ? (md.GetString(d.Namespace) is { Length: > 0 } ns ? ns + "." : "") + n : Name(md.GetTypeDefinition(dh)) + "+" + n;
        }
        ctx.BeforeFieldInit.Add(Name(td));
    }
}

// ------------------------------------------------------------------ selection
var excludedDirs = new[] { "/Core/Nodes/", "/Core/AutoSlay/", "/Core/ControllerInput/", "/Core/Bindings/" };
// pure rule logic that happens to live under Nodes/ (ProgressState sorts epochs with it)
var includedFiles = new[] { "/Core/Nodes/Screens/Timeline/EpochComparer.cs" };
var godotObject = comp.GetTypeByMetadataName("Godot.GodotObject")!;
bool InheritsGodot(INamedTypeSymbol t) { for (var b = t.BaseType; b != null; b = b.BaseType) if (SymbolEqualityComparer.Default.Equals(b, godotObject)) return true; return false; }
bool IsSerializerContext(INamedTypeSymbol t) { for (var b = t.BaseType; b != null; b = b.BaseType) if (b.Name == "JsonSerializerContext") return true; return false; }

var fileTypes = new List<INamedTypeSymbol>();
foreach (var tree in trees)
{
    var path = tree.FilePath.Replace('\\', '/');
    var extra = extraRoots.FirstOrDefault(r => path.StartsWith(r + "/"));
    var rel = extra != null ? path[extra.Length..] : path[(root.Length)..];
    if (extra == null && !rel.StartsWith("/MegaCrit/", StringComparison.OrdinalIgnoreCase)) continue;
    if (excludedDirs.Any(d => rel.Contains(d, StringComparison.OrdinalIgnoreCase)) && !includedFiles.Any(f => rel.EndsWith(f, StringComparison.OrdinalIgnoreCase))) continue;
    var text = tree.GetText().ToString();
    var model = comp.GetSemanticModel(tree);
    foreach (var decl in tree.GetRoot().DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(decl) is not INamedTypeSymbol t) continue;
        var top = t; while (top.ContainingType != null) top = top.ContainingType;
        if (InheritsGodot(top) || IsSerializerContext(top)) continue;
        if (InheritsGodot(t)) continue;
        fileTypes.Add(t);
    }
    foreach (var decl in tree.GetRoot().DescendantNodes().OfType<DelegateDeclarationSyntax>())
        if (model.GetDeclaredSymbol(decl) is INamedTypeSymbol d) fileTypes.Add(d);
}
foreach (var t in fileTypes) ctx.Included.Add(t.OriginalDefinition);

// order: enums, interfaces (by depth), classes (by inheritance depth)
int Depth(INamedTypeSymbol t)
{
    if (t.TypeKind == TypeKind.Interface) return t.AllInterfaces.Length;
    int d = 0;
    for (var b = t.BaseType; b != null && ctx.IsIncluded(b); b = b.BaseType) d++;
    return d;
}
int KindRank(INamedTypeSymbol t) => t.TypeKind switch { TypeKind.Enum => 0, TypeKind.Delegate => 0, TypeKind.Interface => 1, _ => 2 };
ctx.Ordered.AddRange(ctx.Included.OrderBy(KindRank).ThenBy(Depth).ThenBy(t => Ctx.TypeKey(t), StringComparer.Ordinal));
ctx.AssignTypeIds();
ctx.ComputeMemberNames(ctx.Ordered);
ctx.ComputeDupNames();
Console.WriteLine($"selected {ctx.Ordered.Count} types in {sw.ElapsedMilliseconds}ms");

// ------------------------------------------------------------------ emit
var em = new Emitter(ctx);
var bodies = new string[ctx.Ordered.Count];
for (int i = 0; i < ctx.Ordered.Count; i++) bodies[i] = em.EmitType(ctx.Ordered[i]);
Console.WriteLine($"emitted in {sw.ElapsedMilliseconds}ms");

var sb = new StringBuilder();
sb.Append("// @ts-nocheck\n// Generated by tools/cs2ts from the decompiled Slay the Spire 2 rule layer. Do not edit.\n");
sb.Append("import * as $ from \"../rt/index\";\nimport \"./stubs\";\n\n");
foreach (var (t, alias) in ctx.ExtAliases.OrderBy(k => k.Value, StringComparer.Ordinal))
    sb.Append($"const {alias} = $.ext({Emitter.Q(Ctx.TypeKey(t))});\n");
sb.Append("\n");
foreach (var b in bodies) sb.Append(b).Append('\n');
// static constructors run lazily through each class's $ci() guard (C# type-initializer semantics)
sb.Append($"\n$.registerTypes({{ {string.Join(", ", ctx.Ordered.Where(t => t.TypeKind is TypeKind.Class or TypeKind.Struct).Select(t => ctx.TypeId(t)))} }});\n");
File.WriteAllText(Path.Combine(outDir, "sts2.ts"), sb.ToString());
File.WriteAllText(Path.Combine(outDir, "stubs.ts"), Stubs.Generate(ctx, em));
File.WriteAllText(Path.Combine(outDir, "bcl-uses.txt"), string.Join("\n", ctx.BclUses.Select(kv => $"{kv.Value,6} {kv.Key}")) + "\n");
File.WriteAllText(Path.Combine(outDir, "warnings.txt"), string.Join("\n", ctx.Warnings) + "\n");
Console.WriteLine($"wrote {outDir}/sts2.ts ({sb.Length / 1024} KB), {ctx.ExtAliases.Count} external types, {ctx.BclUses.Count} BCL members, {ctx.Warnings.Count} warnings in {sw.ElapsedMilliseconds}ms");
foreach (var g in ctx.Warnings.Select(w => w.Contains(": ") ? w.Split(": ")[1] : w).GroupBy(w => w.Split(' ').Take(3).Aggregate((a, b) => a + " " + b)).OrderByDescending(g => g.Count()).Take(25))
    Console.WriteLine($"  {g.Count(),5} {g.Key}");
