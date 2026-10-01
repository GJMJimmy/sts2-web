shader_type canvas_item;
render_mode blend_mix;

uniform vec4 ColorParameter : source_color = vec4(1.000000, 0.682353, 0.039216, 1.000000);
uniform vec2 step = vec2(0.400000, 0.600000);
uniform sampler2D edgeMask : repeat_enable;
uniform float startingOffset;
uniform float ScrollSpeed = 0.80000001192093;
uniform sampler2D soundwaveTex : repeat_enable;
uniform float amount = 1.0;



void fragment() {
// ColorParameter:16
	vec4 n_out16p0 = ColorParameter;


// Vector2Parameter:18
	vec2 n_out18p0 = step;


// VectorDecompose:19
	float n_out19p0 = n_out18p0.x;
	float n_out19p1 = n_out18p0.y;


	vec4 n_out8p0;
// Texture2D:8
	n_out8p0 = texture(edgeMask, UV);


// FloatParameter:20
	float n_out20p0 = startingOffset;


// Input:5
	float n_out5p0 = TIME;


// FloatOp:21
	float n_out21p0 = n_out20p0 + n_out5p0;


// FloatParameter:17
	float n_out17p0 = ScrollSpeed;


// FloatOp:15
	float n_out15p0 = n_out21p0 * n_out17p0;


// VectorCompose:6
	float n_in6p1 = 1.00000;
	vec2 n_out6p0 = vec2(n_out15p0, n_in6p1);


// UVFunc:4
	vec2 n_in4p1 = vec2(1.00000, 1.00000);
	vec2 n_out4p0 = n_out6p0 * n_in4p1 + UV;


	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(soundwaveTex, n_out4p0);


// VectorOp:11
	vec3 n_out11p0 = vec3(n_out8p0.xyz) * vec3(n_out3p0.xyz);


// FloatParameter:14
	float n_out14p0 = amount;


// FloatOp:13
	float n_out13p0 = n_out11p0.x * n_out14p0;


// SmoothStep:12
	float n_out12p0 = smoothstep(n_out19p0, n_out19p1, n_out13p0);


// Output:0
	COLOR.rgb = vec3(n_out16p0.xyz);
	COLOR.a = n_out12p0;


}
