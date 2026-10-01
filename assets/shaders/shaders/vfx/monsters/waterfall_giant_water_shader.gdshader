shader_type canvas_item;
render_mode blend_mix;

uniform vec4 ColorParameter : source_color = vec4(1.000000, 0.682353, 0.039216, 1.000000);
uniform vec2 movingTexOffset;
uniform vec2 movingTexScale;
uniform vec2 scrollSpeed;
uniform sampler2D movingTex : repeat_enable;
uniform sampler2D waterTex : repeat_enable;



void fragment() {
// ColorParameter:16
	vec4 n_out16p0 = ColorParameter;


// Vector2Parameter:24
	vec2 n_out24p0 = movingTexOffset;


// UVFunc:29
	vec2 n_in29p1 = vec2(1.00000, 1.00000);
	vec2 n_out29p0 = n_out24p0 * n_in29p1 + UV;


// Vector2Parameter:27
	vec2 n_out27p0 = movingTexScale;


// UVFunc:28
	vec2 n_in28p2 = vec2(0.00000, 0.00000);
	vec2 n_out28p0 = (n_out29p0 - n_in28p2) * n_out27p0 + n_in28p2;


// Input:5
	float n_out5p0 = TIME;


// Vector2Parameter:22
	vec2 n_out22p0 = scrollSpeed;


// VectorOp:23
	vec2 n_out23p0 = vec2(n_out5p0) * n_out22p0;


// UVFunc:4
	vec2 n_in4p1 = vec2(1.00000, 1.00000);
	vec2 n_out4p0 = n_out23p0 * n_in4p1 + n_out28p0;


	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(movingTex, n_out4p0);


// VectorOp:11
	vec3 n_out11p0 = vec3(n_out16p0.xyz) * vec3(n_out3p0.xyz);


	vec4 n_out8p0;
// Texture2D:8
	n_out8p0 = texture(waterTex, UV);
	float n_out8p4 = n_out8p0.a;


// VectorOp:26
	vec3 n_out26p0 = n_out11p0 + vec3(n_out8p0.xyz);


// Output:0
	COLOR.rgb = n_out26p0;
	COLOR.a = n_out8p4;


}
