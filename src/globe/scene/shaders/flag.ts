export const flagVertex = /* glsl */ `
  attribute float isPole;
  uniform float uTime;
  varying vec2 vUv;
  varying float vIsPole;
  varying float vShade;

  void main() {
    vUv = uv;
    vIsPole = isPole;
    vec3 p = position;
    float k = uv.x * (1.0 - isPole);
    float phase = uv.x * 7.0 - uTime * 6.0;
    p.z += (sin(phase) * 0.010 + sin(uv.y * 5.0 + uTime * 3.0) * 0.003) * k;
    p.y += sin(phase * 0.5) * 0.003 * k;
    vShade = cos(phase) * k;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const flagFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uPole;
  varying vec2 vUv;
  varying float vIsPole;
  varying float vShade;

  void main() {
    vec3 cloth = texture2D(uMap, vUv).rgb * (0.82 + 0.18 * vShade);
    gl_FragColor = vec4(mix(cloth, uPole, vIsPole), 1.0);
    #include <colorspace_fragment>
  }
`;
