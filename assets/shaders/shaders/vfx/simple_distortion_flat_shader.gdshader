shader_type canvas_item;
render_mode blend_mix;

uniform vec4 Color_Multiply : source_color = vec4(1.000000, 1.000000, 1.000000, 1.000000);
uniform vec2 distortionAmount = vec2(0.000000, 0.000000);
uniform vec2 distortionPanning1 = vec2(0.200000, 0.200000);
uniform sampler2D distortionTexture1 : repeat_enable;



void fragment() {
// ColorParameter:26
	vec4 n_out26p0 = Color_Multiply;


// Input:16
	vec2 n_out16p0 = UV;


// Vector2Parameter:14
	vec2 n_out14p0 = distortionAmount;


// VectorDecompose:23
	float n_out23p0 = n_out14p0.x;
	float n_out23p1 = n_out14p0.y;


// Input:8
	float n_out8p0 = TIME;


// Vector2Parameter:7
	vec2 n_out7p0 = distortionPanning1;


// VectorOp:9
	vec2 n_out9p0 = vec2(n_out8p0) * n_out7p0;


// UVFunc:6
	vec2 n_in6p1 = vec2(1.00000, 1.00000);
	vec2 n_out6p0 = n_out9p0 * n_in6p1 + UV;


	vec4 n_out10p0;
// Texture2D:10
	n_out10p0 = texture(distortionTexture1, n_out6p0);
	float n_out10p1 = n_out10p0.r;


// VectorOp:24
	vec2 n_out24p0 = vec2(n_out23p0) * vec2(n_out10p1);


// VectorOp:11
	vec2 n_out11p0 = vec2(n_out23p1) * vec2(n_out10p1);


// VectorCompose:25
	vec2 n_out25p0 = vec2(n_out24p0.x, n_out11p0.x);


// VectorOp:12
	vec2 n_out12p0 = n_out16p0 + n_out25p0;


	vec4 n_out2p0;
// Texture2D:2
	n_out2p0 = texture(TEXTURE, n_out12p0);
	float n_out2p4 = n_out2p0.a;


// VectorOp:27
	vec3 n_out27p0 = vec3(n_out26p0.xyz) * vec3(n_out2p0.xyz);


// Output:0
	COLOR.rgb = n_out27p0;
	COLOR.a = n_out2p4;


}
