shader_type canvas_item;
render_mode blend_mix;

uniform sampler2D Texture2DParameter : hint_screen_texture;



void fragment() {
	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(Texture2DParameter, UV);
	float n_out3p4 = n_out3p0.a;


// Output:0
	COLOR.rgb = vec3(n_out3p0.xyz);
	COLOR.a = n_out3p4;


}
