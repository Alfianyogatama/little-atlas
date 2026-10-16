export const landVertex = /* glsl */ `
  attribute float countryIndex;
  attribute float colorIndex;
  uniform float uSelectedIndex;
  uniform float uLift;
  uniform float uWobble;
  varying float vColorIndex;
  varying float vSelected;
  varying vec3 vNormal;

  void main() {
    float selected = step(abs(countryIndex - uSelectedIndex), 0.5);
    vec3 dir = normalize(position);
    vec3 p = position + dir * uLift * selected;
    p += normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4)) * uWobble * 0.15 * selected;
    vColorIndex = colorIndex;
    vSelected = selected;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const landFragment = /* glsl */ `
  uniform vec3 uPalette[5];
  uniform vec3 uSelect;
  uniform vec3 uNeutral;
  uniform vec3 uIce;
  varying float vColorIndex;
  varying float vSelected;
  varying vec3 vNormal;

  void main() {
    vec3 base;
    if (vSelected > 0.5) {
      base = uSelect;
    } else if (vColorIndex < -1.5) {
      base = uIce;
    } else if (vColorIndex < -0.5) {
      base = uNeutral;
    } else {
      base = uPalette[int(clamp(vColorIndex + 0.5, 0.0, 4.0))];
    }
    float diffuse = max(dot(normalize(vNormal), normalize(vec3(0.4, 0.6, 0.7))), 0.0);
    gl_FragColor = vec4(base * (0.7 + 0.3 * diffuse), 1.0);
    #include <colorspace_fragment>
  }
`;
