shader_type canvas_item;
render_mode blend_add;

uniform vec4 AddColor : source_color = vec4(0.000000, 0.483333, 1.000000, 1.000000);
uniform vec2 NoisePanSpeed = vec2(0.000000, 0.000000);
uniform vec2 NoiseScale = vec2(10.000000, 10.000000);
uniform sampler2D NoiseTexture : repeat_enable;
uniform float NoiseStrength = 0.00999999977648;
uniform sampler2D tex_frg_30;
uniform vec2 TexturePanSpeed = vec2(1.000000, 1.000000);
uniform vec2 TextureOffset;
uniform vec2 SidesMaskStep = vec2(0.100000, 0.300000);
uniform sampler2D Sides_Mask;
uniform vec2 TopBottomMaskStep = vec2(0.500000, 0.700000);
uniform vec2 TopBottomMaskOffset;
uniform sampler2D TopBottomMask;



void fragment() {
// ColorParameter:67
	vec4 n_out67p0 = AddColor;


// Input:80
	float n_out80p0 = TIME;


// Vector2Parameter:79
	vec2 n_out79p0 = NoisePanSpeed;


// VectorOp:81
	vec2 n_out81p0 = vec2(n_out80p0) * n_out79p0;


// UVFunc:78
	vec2 n_in78p1 = vec2(1.00000, 1.00000);
	vec2 n_out78p0 = n_out81p0 * n_in78p1 + UV;


// Vector2Parameter:77
	vec2 n_out77p0 = NoiseScale;


// UVFunc:76
	vec2 n_in76p2 = vec2(0.00000, 0.00000);
	vec2 n_out76p0 = (n_out78p0 - n_in76p2) * n_out77p0 + n_in76p2;


	vec4 n_out71p0;
// Texture2D:71
	n_out71p0 = texture(NoiseTexture, n_out76p0);


// UVFunc:69
	vec2 n_in69p1 = vec2(0.00000, 0.00000);
	vec2 n_in69p2 = vec2(1.00000, 1.00000);
	vec2 n_out69p0 = n_in69p2 * n_in69p1 + vec2(n_out71p0.xy);


// FloatParameter:74
	float n_out74p0 = NoiseStrength;


// VectorOp:75
	vec3 n_out75p0 = vec3(n_out69p0, 0.0) * vec3(n_out74p0);


// Texture2D:30
	vec4 n_out30p0 = texture(tex_frg_30, UV);


// UVFunc:40
	vec2 n_in40p1 = vec2(0.00000, 0.00000);
	vec2 n_in40p2 = vec2(0.00000, -0.07500);
	vec2 n_out40p0 = (UV - n_in40p2) * n_in40p1 + n_in40p2;


// VectorOp:39
	vec3 n_out39p0 = vec3(n_out30p0.xyz) * vec3(n_out40p0, 0.0);


// Input:33
	float n_out33p0 = TIME;


// Vector2Parameter:64
	vec2 n_out64p0 = TexturePanSpeed;


// VectorOp:65
	vec2 n_out65p0 = vec2(n_out33p0) * n_out64p0;


// VectorOp:66
	vec2 n_in66p1 = vec2(1.00000, 1.00000);
	vec2 n_out66p0 = n_out65p0 + n_in66p1;


// Vector2Parameter:55
	vec2 n_out55p0 = TextureOffset;


// VectorOp:56
	vec2 n_out56p0 = n_out66p0 + n_out55p0;


// UVFunc:29
	vec2 n_in29p1 = vec2(1.00000, 1.00000);
	vec2 n_out29p0 = n_out56p0 * n_in29p1 + UV;


// VectorOp:37
	vec3 n_out37p0 = n_out39p0 + vec3(n_out29p0, 0.0);


// VectorOp:70
	vec3 n_out70p0 = n_out75p0 + n_out37p0;


	vec4 n_out38p0;
// Texture2D:38
	n_out38p0 = texture(TEXTURE, vec2(n_out70p0.xy));


// VectorDecompose:49
	float n_out49p0 = n_out38p0.x;
	float n_out49p1 = n_out38p0.y;
	float n_out49p2 = n_out38p0.z;
	float n_out49p3 = n_out38p0.w;


// VectorCompose:50
	vec3 n_out50p0 = vec3(n_out49p0, n_out49p1, n_out49p2);


// VectorOp:68
	vec3 n_out68p0 = vec3(n_out67p0.xyz) + n_out50p0;


// Vector2Parameter:58
	vec2 n_out58p0 = SidesMaskStep;


// VectorDecompose:59
	float n_out59p0 = n_out58p0.x;
	float n_out59p1 = n_out58p0.y;


	vec4 n_out42p0;
// Texture2D:42
	n_out42p0 = texture(Sides_Mask, UV);


// SmoothStep:44
	float n_out44p0 = smoothstep(n_out59p0, n_out59p1, n_out42p0.x);


// VectorOp:48
	vec3 n_out48p0 = vec3(n_out49p3) * vec3(n_out44p0);


// Vector2Parameter:60
	vec2 n_out60p0 = TopBottomMaskStep;


// VectorDecompose:61
	float n_out61p0 = n_out60p0.x;
	float n_out61p1 = n_out60p0.y;


// Vector2Parameter:62
	vec2 n_out62p0 = TopBottomMaskOffset;


// UVFunc:63
	vec2 n_in63p1 = vec2(1.00000, 1.00000);
	vec2 n_out63p0 = n_out62p0 * n_in63p1 + UV;


	vec4 n_out43p0;
// Texture2D:43
	n_out43p0 = texture(TopBottomMask, n_out63p0);


// SmoothStep:45
	float n_out45p0 = smoothstep(n_out61p0, n_out61p1, n_out43p0.x);


// VectorOp:46
	vec3 n_out46p0 = n_out48p0 * vec3(n_out45p0);


// Output:0
	COLOR.rgb = n_out68p0;
	COLOR.a = n_out46p0.x;


}
