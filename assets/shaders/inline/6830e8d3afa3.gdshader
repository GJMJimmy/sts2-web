shader_type canvas_item;
render_mode blend_mix;

uniform vec2 Step;
uniform vec2 mask_offset = vec2(2.000000, 3.000000);
uniform sampler2D noise_tex : repeat_enable;



void fragment() {
// Input:2
	vec4 n_out2p0 = COLOR;
	float n_out2p4 = n_out2p0.a;


// Vector2Parameter:30
	vec2 n_out30p0 = Step;
	float n_out30p1 = n_out30p0.r;
	float n_out30p2 = n_out30p0.g;


	vec4 n_out4p0;
// Texture2D:4
	n_out4p0 = texture(TEXTURE, UV);


// VectorDecompose:9
	float n_out9p0 = n_out4p0.x;
	float n_out9p1 = n_out4p0.y;
	float n_out9p2 = n_out4p0.z;
	float n_out9p3 = n_out4p0.w;


// Input:24
	vec2 n_out24p0 = UV;


// Input:12
	float n_out12p0 = TIME;


// Vector2Parameter:17
	vec2 n_out17p0 = mask_offset;


// VectorOp:18
	vec2 n_out18p0 = vec2(n_out12p0) * n_out17p0;


// UVFunc:11
	vec2 n_in11p1 = vec2(2.00000, 0.20000);
	vec2 n_out11p0 = n_out18p0 * n_in11p1 + n_out24p0;


	vec4 n_out14p0;
// Texture2D:14
	n_out14p0 = texture(noise_tex, n_out11p0);


// FloatOp:28
	float n_out28p0 = n_out9p0 * n_out14p0.x;


// FloatOp:27
	float n_out27p0 = n_out2p4 * n_out28p0;


// SmoothStep:29
	float n_out29p0 = smoothstep(n_out30p1, n_out30p2, n_out27p0);


// Output:0
	COLOR.rgb = vec3(n_out2p0.xyz);
	COLOR.a = n_out29p0;


}
