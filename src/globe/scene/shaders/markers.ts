export const markersVertex = /* glsl */ `
  attribute float countryIndex;
  attribute float colorIndex;
  uniform float uSelectedIndex;
  uniform float uLift;
  varying float vColorIndex;
  varying float vSelected;
  varying vec3 vNormal;

  void main() {
    float selected = step(abs(countryIndex - uSelectedIndex), 0.5);
    vec4 world = instanceMatrix * vec4(position, 1.0);
    vec3 p = world.xyz + normalize(world.xyz) * uLift * selected;
    vColorIndex = colorIndex;
    vSelected = selected;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const markersFragment = /* glsl */ `
  uniform vec3 uPalette[5];
  uniform vec3 uSelect;
  uniform vec3 uNeutral;
  varying float vColorIndex;
  varying float vSelected;
  varying vec3 vNormal;

  void main() {
    vec3 base = vColorIndex < -0.5 ? uNeutral : uPalette[int(clamp(vColorIndex + 0.5, 0.0, 4.0))];
    base = mix(base, uSelect, vSelected);
    float diffuse = max(dot(normalize(vNormal), normalize(vec3(0.4, 0.6, 0.7))), 0.0);
    gl_FragColor = vec4(base * (0.75 + 0.25 * diffuse), 1.0);
    #include <colorspace_fragment>
  }
`;
