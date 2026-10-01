shader_type canvas_item;
render_mode blend_mix;

uniform vec4 Color : source_color = vec4(1.000000, 1.000000, 1.000000, 1.000000);
uniform float ScrollSpeed = 0.20000000298023;
uniform float timeOffset;
uniform sampler2D smokeTex : repeat_enable;
uniform vec2 AlphaStep = vec2(0.000000, 1.000000);
uniform sampler2D alphaGradient : repeat_enable;
uniform float Ovarall_Alpha = 1.0;



void fragment() {
// ColorParameter:17
	vec4 n_out17p0 = Color;


// FloatParameter:7
	float n_out7p0 = ScrollSpeed;


// Input:5
	float n_out5p0 = TIME;


// FloatOp:8
	float n_out8p0 = n_out7p0 * n_out5p0;


// FloatParameter:15
	float n_out15p0 = timeOffset;


// FloatOp:16
	float n_out16p0 = n_out8p0 + n_out15p0;


// VectorCompose:6
	float n_in6p0 = 0.00000;
	float n_in6p2 = 0.00000;
	vec3 n_out6p0 = vec3(n_in6p0, n_out16p0, n_in6p2);


// UVFunc:4
	vec2 n_in4p1 = vec2(1.00000, 1.00000);
	vec2 n_out4p0 = vec2(n_out6p0.xy) * n_in4p1 + UV;


	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(smokeTex, n_out4p0);


// VectorOp:18
	vec3 n_out18p0 = vec3(n_out17p0.xyz) * vec3(n_out3p0.xyz);


// Vector2Parameter:20
	vec2 n_out20p0 = AlphaStep;


// VectorDecompose:21
	float n_out21p0 = n_out20p0.x;
	float n_out21p1 = n_out20p0.y;


// VectorDecompose:12
	float n_out12p0 = n_out3p0.x;
	float n_out12p1 = n_out3p0.y;
	float n_out12p2 = n_out3p0.z;
	float n_out12p3 = n_out3p0.w;


	vec4 n_out10p0;
// Texture2D:10
	n_out10p0 = texture(alphaGradient, UV);
	float n_out10p1 = n_out10p0.r;


// FloatOp:11
	float n_out11p0 = n_out12p3 * n_out10p1;


// SmoothStep:19
	float n_out19p0 = smoothstep(n_out21p0, n_out21p1, n_out11p0);


// FloatParameter:28
	float n_out28p0 = Ovarall_Alpha;


// FloatOp:27
	float n_out27p0 = n_out19p0 * n_out28p0;


// Output:0
	COLOR.rgb = n_out18p0;
	COLOR.a = n_out27p0;


}
