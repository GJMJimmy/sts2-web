shader_type canvas_item;
render_mode blend_add;

uniform vec4 Color : source_color = vec4(1.000000, 1.000000, 1.000000, 1.000000);
uniform bool MultiplyVsAdd = true;



void fragment() {
// ColorParameter:2
	vec4 n_out2p0 = Color;


	vec4 n_out4p0;
// Texture2D:4
	n_out4p0 = texture(TEXTURE, UV);


// VectorOp:5
	vec4 n_out5p0 = n_out2p0 * n_out4p0;


// BooleanParameter:7
	bool n_out7p0 = MultiplyVsAdd;


// VectorOp:15
	vec4 n_out15p0 = n_out5p0 * vec4(n_out7p0 ? 1.0 : 0.0);


// FloatFunc:13
	float n_out13p0 = 1.0 - (n_out7p0 ? 1.0 : 0.0);


// VectorOp:8
	vec4 n_out8p0 = n_out2p0 + n_out4p0;


// VectorOp:12
	vec4 n_out12p0 = vec4(n_out13p0) * n_out8p0;


// VectorOp:14
	vec4 n_out14p0 = n_out15p0 + n_out12p0;


// Output:0
	COLOR.rgb = vec3(n_out14p0.xyz);


}
