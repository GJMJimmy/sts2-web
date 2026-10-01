shader_type canvas_item;
render_mode blend_mix;

uniform int direction = 1;
uniform sampler2D suckPattern : repeat_enable;
uniform sampler2D suckGradient;
uniform sampler2D suckShape;
uniform float opacity = 1.0;



void fragment() {
// ColorConstant:2
	vec4 n_out2p0 = vec4(0.015300, 0.090072, 0.170000, 1.000000);


// UVFunc:22
	vec2 n_in22p1 = vec2(1.00000, 1.00000);
	vec2 n_in22p2 = vec2(0.20000, -0.05000);
	vec2 n_out22p0 = n_in22p2 * n_in22p1 + UV;


// UVFunc:26
	vec2 n_in26p1 = vec2(3.00000, 3.00000);
	vec2 n_in26p2 = vec2(0.00000, 0.00000);
	vec2 n_out26p0 = (UV - n_in26p2) * n_in26p1 + n_in26p2;


// Input:7
	float n_out7p0 = TIME;


// FloatConstant:44
	float n_out44p0 = -0.500000;


// FloatConstant:45
	float n_out45p0 = 4.000000;


// IntParameter:37
	int n_out37p0 = direction;


// MultiplyAdd:40
	float n_in40p2 = 0.00000;
	float n_out40p0 = fma(n_out45p0, float(n_out37p0), n_in40p2);


// VectorCompose:43
	vec2 n_out43p0 = vec2(n_out44p0, n_out40p0);


// VectorOp:11
	vec2 n_out11p0 = vec2(n_out7p0) * n_out43p0;


// UVFunc:8
	vec2 n_in8p1 = vec2(1.00000, 1.00000);
	vec2 n_out8p0 = n_out11p0 * n_in8p1 + n_out26p0;


	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(suckPattern, n_out8p0);


// UVFunc:27
	vec2 n_in27p1 = vec2(2.00000, 2.00000);
	vec2 n_in27p2 = vec2(0.00000, 0.00000);
	vec2 n_out27p0 = (UV - n_in27p2) * n_in27p1 + n_in27p2;


// FloatConstant:48
	float n_out48p0 = 1.000000;


// FloatConstant:46
	float n_out46p0 = 3.000000;


// MultiplyAdd:41
	float n_in41p2 = 0.00000;
	float n_out41p0 = fma(float(n_out37p0), n_out46p0, n_in41p2);


// VectorCompose:47
	vec2 n_out47p0 = vec2(n_out48p0, n_out41p0);


// VectorOp:19
	vec2 n_out19p0 = vec2(n_out7p0) * n_out47p0;


// UVFunc:20
	vec2 n_in20p1 = vec2(1.00000, 1.00000);
	vec2 n_out20p0 = n_out19p0 * n_in20p1 + n_out27p0;


	vec4 n_out17p0;
// Texture2D:17
	n_out17p0 = texture(suckPattern, n_out20p0);


// VectorOp:18
	vec4 n_out18p0 = n_out3p0 * n_out17p0;


// VectorOp:23
	vec3 n_out23p0 = vec3(n_out22p0, 0.0) + vec3(n_out18p0.xyz);


	vec4 n_out16p0;
// Texture2D:16
	n_out16p0 = texture(suckGradient, vec2(n_out23p0.xy));


// SmoothStep:14
	float n_in14p0 = 0.40000;
	float n_in14p1 = 0.60000;
	float n_out14p0 = smoothstep(n_in14p0, n_in14p1, n_out16p0.x);


// UVFunc:29
	vec2 n_in29p1 = vec2(1.00000, 1.00000);
	vec2 n_in29p2 = vec2(0.00000, 0.00000);
	vec2 n_out29p0 = n_in29p2 * n_in29p1 + UV;


// VectorOp:30
	vec2 n_in30p1 = vec2(0.03000, 0.00000);
	vec2 n_out30p0 = vec2(n_out18p0.xy) * n_in30p1;


// VectorOp:28
	vec3 n_out28p0 = vec3(n_out29p0, 0.0) + vec3(n_out30p0, 0.0);


	vec4 n_out13p0;
// Texture2D:13
	n_out13p0 = texture(suckShape, vec2(n_out28p0.xy));


// SmoothStep:25
	float n_in25p0 = 0.40000;
	float n_in25p1 = 0.70000;
	float n_out25p0 = smoothstep(n_in25p0, n_in25p1, n_out13p0.x);


// VectorOp:24
	vec3 n_out24p0 = vec3(n_out14p0) * vec3(n_out25p0);


// FloatParameter:49
	float n_out49p0 = opacity;


// FloatOp:50
	float n_out50p0 = n_out24p0.x * n_out49p0;


// Output:0
	COLOR.rgb = vec3(n_out2p0.xyz);
	COLOR.a = n_out50p0;


}
