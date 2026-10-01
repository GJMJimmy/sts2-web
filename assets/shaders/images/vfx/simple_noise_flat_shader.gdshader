shader_type canvas_item;
render_mode blend_mix;

uniform vec2 Step;
uniform vec2 mask_scale = vec2(1.000000, 1.000000);
uniform vec2 mask_panning = vec2(2.000000, 3.000000);
uniform sampler2D noise_tex : repeat_enable;
uniform vec2 mask2_scale = vec2(1.000000, 1.000000);
uniform vec2 mask2_panning = vec2(0.200000, 0.300000);
uniform sampler2D noise_tex2 : repeat_enable;



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


// Vector2Parameter:23
	vec2 n_out23p0 = mask_scale;


// UVFunc:31
	vec2 n_in31p2 = vec2(-0.27500, 0.00000);
	vec2 n_out31p0 = (UV - n_in31p2) * n_out23p0 + n_in31p2;


// Input:12
	float n_out12p0 = TIME;


// Vector2Parameter:17
	vec2 n_out17p0 = mask_panning;


// VectorOp:18
	vec2 n_out18p0 = vec2(n_out12p0) * n_out17p0;


// UVFunc:11
	vec2 n_in11p1 = vec2(1.00000, 1.00000);
	vec2 n_out11p0 = n_out18p0 * n_in11p1 + n_out31p0;


	vec4 n_out14p0;
// Texture2D:14
	n_out14p0 = texture(noise_tex, n_out11p0);


// Vector2Parameter:34
	vec2 n_out34p0 = mask2_scale;


// UVFunc:35
	vec2 n_in35p2 = vec2(-0.27500, 0.00000);
	vec2 n_out35p0 = (UV - n_in35p2) * n_out34p0 + n_in35p2;


// Vector2Parameter:32
	vec2 n_out32p0 = mask2_panning;


// VectorOp:33
	vec2 n_out33p0 = vec2(n_out12p0) * n_out32p0;


// UVFunc:36
	vec2 n_in36p1 = vec2(1.00000, 1.00000);
	vec2 n_out36p0 = n_out33p0 * n_in36p1 + n_out35p0;


	vec4 n_out38p0;
// Texture2D:38
	n_out38p0 = texture(noise_tex2, n_out36p0);


// FloatOp:40
	float n_out40p0 = n_out14p0.x * n_out38p0.x;


// FloatOp:28
	float n_out28p0 = n_out9p0 * n_out40p0;


// FloatOp:27
	float n_out27p0 = n_out2p4 * n_out28p0;


// SmoothStep:29
	float n_out29p0 = smoothstep(n_out30p1, n_out30p2, n_out27p0);


// Output:0
	COLOR.rgb = vec3(n_out2p0.xyz);
	COLOR.a = n_out29p0;


}
