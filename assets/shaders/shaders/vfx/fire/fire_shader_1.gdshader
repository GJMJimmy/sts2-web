shader_type canvas_item;
render_mode blend_mix;

uniform vec4 ColorParameter : source_color;
uniform vec2 Smooth_Step = vec2(0.480000, 0.500000);
uniform float Noise_Intensity_1 = 1.0;
uniform float NoiseScale1 = 1.0;
uniform float TimeOffset = 0.0;
uniform vec2 Noise_Scroll_1 = vec2(0.200000, 0.200000);
uniform sampler2D NoiseTexture1 : repeat_enable;
uniform float NoiseScale2 = 1.0;
uniform vec2 Noise_Scroll_2 = vec2(0.200000, 0.200000);
uniform sampler2D NoiseTexture2 : repeat_enable;
uniform float Noise_Intensity_2 = 1.0;
uniform sampler2D top_gradient;
uniform float MaskNoiseIntensity;
uniform vec2 MaskNoiseScroll;
uniform sampler2D MaskNoiseTexture : repeat_enable;
uniform sampler2D Shape_Mask;



void fragment() {
// ColorParameter:35
	vec4 n_out35p0 = ColorParameter;


// Vector2Parameter:23
	vec2 n_out23p0 = Smooth_Step;


// VectorDecompose:24
	float n_out24p0 = n_out23p0.x;
	float n_out24p1 = n_out23p0.y;


// UVFunc:54
	vec2 n_in54p1 = vec2(1.00000, 1.00000);
	vec2 n_in54p2 = vec2(-1.06500, -0.24000);
	vec2 n_out54p0 = n_in54p2 * n_in54p1 + UV;


// FloatParameter:25
	float n_out25p0 = Noise_Intensity_1;


// FloatFunc:40
	float n_out40p0 = 1.0 - n_out25p0;


// FloatParameter:61
	float n_out61p0 = NoiseScale1;


// UVFunc:57
	vec2 n_in57p2 = vec2(0.00000, 0.00000);
	vec2 n_out57p0 = (UV - n_in57p2) * vec2(n_out61p0) + n_in57p2;


// Input:5
	float n_out5p0 = TIME;


// FloatParameter:62
	float n_out62p0 = TimeOffset;


// FloatOp:64
	float n_out64p0 = n_out5p0 + n_out62p0;


// Vector2Parameter:6
	vec2 n_out6p0 = Noise_Scroll_1;


// VectorOp:7
	vec2 n_out7p0 = vec2(n_out64p0) * n_out6p0;


// UVFunc:4
	vec2 n_in4p1 = vec2(1.00000, 1.00000);
	vec2 n_out4p0 = n_out7p0 * n_in4p1 + n_out57p0;


	vec4 n_out3p0;
// Texture2D:3
	n_out3p0 = texture(NoiseTexture1, n_out4p0);


// VectorDecompose:28
	float n_out28p0 = vec3(n_out3p0.xyz).x;
	float n_out28p1 = vec3(n_out3p0.xyz).y;
	float n_out28p2 = vec3(n_out3p0.xyz).z;


// FloatOp:41
	float n_out41p0 = n_out40p0 + n_out28p0;


// FloatParameter:60
	float n_out60p0 = NoiseScale2;


// UVFunc:59
	vec2 n_in59p2 = vec2(0.00000, 0.00000);
	vec2 n_out59p0 = (UV - n_in59p2) * vec2(n_out60p0) + n_in59p2;


// Vector2Parameter:11
	vec2 n_out11p0 = Noise_Scroll_2;


// VectorOp:10
	vec2 n_out10p0 = vec2(n_out64p0) * n_out11p0;


// UVFunc:9
	vec2 n_in9p1 = vec2(3.00000, 3.00000);
	vec2 n_out9p0 = n_out10p0 * n_in9p1 + n_out59p0;


	vec4 n_out12p0;
// Texture2D:12
	n_out12p0 = texture(NoiseTexture2, n_out9p0);


// VectorDecompose:30
	float n_out30p0 = vec3(n_out12p0.xyz).x;
	float n_out30p1 = vec3(n_out12p0.xyz).y;
	float n_out30p2 = vec3(n_out12p0.xyz).z;


// FloatParameter:26
	float n_out26p0 = Noise_Intensity_2;


// FloatFunc:39
	float n_out39p0 = 1.0 - n_out26p0;


// FloatOp:38
	float n_out38p0 = n_out30p0 + n_out39p0;


// FloatOp:32
	float n_out32p0 = n_out41p0 * n_out38p0;


// VectorOp:56
	vec2 n_out56p0 = n_out54p0 + vec2(n_out32p0);


	vec4 n_out21p0;
// Texture2D:21
	n_out21p0 = texture(top_gradient, n_out56p0);


// VectorDecompose:34
	float n_out34p0 = n_out21p0.x;
	float n_out34p1 = n_out21p0.y;
	float n_out34p2 = n_out21p0.z;
	float n_out34p3 = n_out21p0.w;


// Input:50
	vec2 n_out50p0 = UV;


// FloatParameter:52
	float n_out52p0 = MaskNoiseIntensity;


// Input:48
	float n_out48p0 = TIME;


// Vector2Parameter:43
	vec2 n_out43p0 = MaskNoiseScroll;


// VectorOp:44
	vec2 n_out44p0 = vec2(n_out48p0) * n_out43p0;


// UVFunc:42
	vec2 n_in42p1 = vec2(1.00000, 1.00000);
	vec2 n_out42p0 = n_out44p0 * n_in42p1 + UV;


	vec4 n_out45p0;
// Texture2D:45
	n_out45p0 = texture(MaskNoiseTexture, n_out42p0);


// VectorOp:53
	vec2 n_out53p0 = vec2(n_out52p0) * vec2(n_out45p0.xy);


// VectorOp:51
	vec2 n_out51p0 = n_out50p0 + n_out53p0;


	vec4 n_out16p0;
// Texture2D:16
	n_out16p0 = texture(Shape_Mask, n_out51p0);


// VectorDecompose:19
	float n_out19p0 = n_out16p0.x;
	float n_out19p1 = n_out16p0.y;
	float n_out19p2 = n_out16p0.z;
	float n_out19p3 = n_out16p0.w;


// FloatOp:49
	float n_out49p0 = n_out34p0 * n_out19p0;


// SmoothStep:18
	float n_out18p0 = smoothstep(n_out24p0, n_out24p1, n_out49p0);


// Output:0
	COLOR.rgb = vec3(n_out35p0.xyz);
	COLOR.a = n_out18p0;


}
