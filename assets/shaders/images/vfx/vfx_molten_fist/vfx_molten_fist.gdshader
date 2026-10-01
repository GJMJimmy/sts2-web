shader_type canvas_item;
render_mode blend_mix;

uniform vec2 NoiseStep = vec2(0.100000, 0.200000);
uniform float Noise2Strength = 1;
uniform vec2 Noise2Scaling = vec2(1.000000, 1.000000);
uniform vec2 Noise2Panning = vec2(1.000000, 1.000000);
uniform sampler2D Noise2Texture : repeat_enable;
uniform float Noise1Strength = 1;
uniform vec2 Noise1Scaling = vec2(1.000000, 1.000000);
uniform vec2 Noise1Panning = vec2(1.000000, 1.000000);
uniform sampler2D Noise1Texture : repeat_enable;
uniform bool InvertNoiseMask = true;
uniform vec2 NoiseMaskScale = vec2(1.000000, 1.000000);
uniform vec2 NoiseMaskOffset;
uniform sampler2D NoiseMask : repeat_disable;
uniform sampler2D tex_frg_40;



void fragment() {
// Vector2Parameter:3
	vec2 n_out3p0 = NoiseStep;


// VectorDecompose:4
	float n_out4p0 = n_out3p0.x;
	float n_out4p1 = n_out3p0.y;


// FloatParameter:29
	float n_out29p0 = Noise2Strength;


// Vector2Parameter:35
	vec2 n_out35p0 = Noise2Scaling;


// UVFunc:36
	vec2 n_in36p2 = vec2(0.00000, 0.00000);
	vec2 n_out36p0 = (UV - n_in36p2) * n_out35p0 + n_in36p2;


// Vector2Parameter:12
	vec2 n_out12p0 = Noise2Panning;


// Input:14
	float n_out14p0 = TIME;


// VectorOp:13
	vec2 n_out13p0 = n_out12p0 * vec2(n_out14p0);


// UVFunc:16
	vec2 n_in16p1 = vec2(1.00000, 1.00000);
	vec2 n_out16p0 = n_out13p0 * n_in16p1 + n_out36p0;


	vec4 n_out15p0;
// Texture2D:15
	n_out15p0 = texture(Noise2Texture, n_out16p0);
	float n_out15p3 = n_out15p0.b;


// FloatOp:30
	float n_out30p0 = n_out29p0 * n_out15p3;


// FloatParameter:25
	float n_out25p0 = Noise1Strength;


// Vector2Parameter:34
	vec2 n_out34p0 = Noise1Scaling;


// UVFunc:33
	vec2 n_in33p2 = vec2(0.00000, 0.00000);
	vec2 n_out33p0 = (UV - n_in33p2) * n_out34p0 + n_in33p2;


// Vector2Parameter:9
	vec2 n_out9p0 = Noise1Panning;


// Input:11
	float n_out11p0 = TIME;


// VectorOp:10
	vec2 n_out10p0 = n_out9p0 * vec2(n_out11p0);


// UVFunc:6
	vec2 n_in6p1 = vec2(1.00000, 1.00000);
	vec2 n_out6p0 = n_out10p0 * n_in6p1 + n_out33p0;


	vec4 n_out8p0;
// Texture2D:8
	n_out8p0 = texture(Noise1Texture, n_out6p0);
	float n_out8p3 = n_out8p0.b;


// FloatOp:28
	float n_out28p0 = n_out25p0 * n_out8p3;


// FloatOp:27
	float n_out27p0 = n_out30p0 * n_out28p0;


// BooleanParameter:22
	bool n_out22p0 = InvertNoiseMask;


// Vector2Parameter:31
	vec2 n_out31p0 = NoiseMaskScale;


// UVFunc:32
	vec2 n_in32p2 = vec2(0.00000, 0.04000);
	vec2 n_out32p0 = (UV - n_in32p2) * n_out31p0 + n_in32p2;


// Vector2Parameter:20
	vec2 n_out20p0 = NoiseMaskOffset;


// UVFunc:19
	vec2 n_in19p1 = vec2(1.00000, 1.00000);
	vec2 n_out19p0 = n_out20p0 * n_in19p1 + n_out32p0;


	vec4 n_out18p0;
// Texture2D:18
	n_out18p0 = texture(NoiseMask, n_out19p0);
	float n_out18p3 = n_out18p0.b;


// FloatFunc:24
	float n_out24p0 = 1.0 - n_out18p3;


	float n_out23p0;
// Switch:23
	n_out23p0 = mix(n_out18p3, n_out24p0, float(n_out22p0));


// FloatOp:26
	float n_out26p0 = n_out27p0 + n_out23p0;


// Texture2D:40
	vec4 n_out40p0 = texture(tex_frg_40, UV);
	float n_out40p4 = n_out40p0.a;


// FloatOp:38
	float n_out38p0 = n_out26p0 * n_out40p4;


// SmoothStep:5
	float n_out5p0 = smoothstep(n_out4p0, n_out4p1, n_out38p0);


// Output:0
	COLOR.a = n_out5p0;


}
