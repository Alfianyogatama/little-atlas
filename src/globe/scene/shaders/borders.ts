export const bordersVertex = /* glsl */ `
  attribute float countryIndex;
  uniform float uSelectedIndex;
  uniform float uLift;
  varying float vSelected;

  void main() {
    float selected = step(abs(countryIndex - uSelectedIndex), 0.5);
    vec3 p = position + normalize(position) * uLift * selected;
    vSelected = selected;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const bordersFragment = /* glsl */ `
  uniform vec3 uBorder;
  uniform vec3 uCoral;
  varying float vSelected;

  void main() {
    gl_FragColor = vec4(mix(uBorder, uCoral, vSelected), 1.0);
    #include <colorspace_fragment>
  }
`;
