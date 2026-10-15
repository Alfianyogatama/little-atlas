export const oceanVertex = /* glsl */ `
  varying vec3 vObjectNormal;

  void main() {
    vObjectNormal = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const oceanFragment = /* glsl */ `
  uniform vec3 uOcean;
  uniform vec3 uOceanLight;
  varying vec3 vObjectNormal;

  void main() {
    gl_FragColor = vec4(mix(uOcean, uOceanLight, abs(vObjectNormal.y)), 1.0);
    #include <colorspace_fragment>
  }
`;
