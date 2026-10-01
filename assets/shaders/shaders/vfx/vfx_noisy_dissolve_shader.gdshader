shader_type canvas_item;
render_mode blend_mix;

uniform float step = 0.0;
uniform float step_spread = 0.10000000149012;
uniform vec2 NoisePanning = vec2(0.000000, 0.000000);
uniform sampler2D NoiseTexture : repeat_enable;



void fragment() {
// FloatParameter:8
	float n_out8p0 = step;


// FloatParameter:21
	float n_out21p0 = step_spread;


// FloatOp:19
	float n_out19p0 = n_out8p0 + n_out21p0;


// Vector2Parameter:13
	vec2 n_out13p0 = NoisePanning;


// Input:14
	float n_out14p0 = TIME;


// VectorOp:15
	vec2 n_out15p0 = n_out13p0 * vec2(n_out14p0);


// UVFunc:16
	vec2 n_in16p1 = vec2(1.00000, 1.00000);
	vec2 n_out16p0 = n_out15p0 * n_in16p1 + UV;


	vec4 n_out5p0;
// Texture2D:5
	n_out5p0 = texture(NoiseTexture, n_out16p0);
	float n_out5p1 = n_out5p0.r;


// SmoothStep:7
	float n_out7p0 = smoothstep(n_out8p0, n_out19p0, n_out5p1);


	vec4 n_out11p0;
// Texture2D:11
	n_out11p0 = texture(TEXTURE, UV);
	float n_out11p4 = n_out11p0.a;


// FloatOp:12
	float n_out12p0 = n_out7p0 * n_out11p4;


// Output:0
	COLOR.a = n_out12p0;


}
