// Shaders. Everything is lit with the same Minecraft-style lightmap so blocks,
// mobs, items and particles match: sky light scaled by daylight, warm block light.
import * as THREE from 'three';

// shared uniforms (mutated every frame by the renderer)
export const U = {
  uTime: { value: 0 },
  uDaylight: { value: 1 },
  uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
  uTorchColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 1.0) },
  uFogNear: { value: 80 },
  uFogFar: { value: 120 },
  uGamma: { value: 0.5 },
  uWind: { value: 1 },
  uFlash: { value: 0 },
};

const LIGHT_GLSL = /* glsl */`
uniform float uDaylight;
uniform vec3 uSkyLightColor;
uniform vec3 uTorchColor;
uniform float uGamma;
uniform float uFlash;
float lcurve(float l) {
  float f = clamp(l / 15.0, 0.0, 1.0);
  float b = f / (4.0 - 3.0 * f);
  float g = 1.0 - pow(1.0 - b, 4.0);
  return mix(b, g, uGamma) * 0.96 + 0.04;
}
vec3 lightmap(float sky, float blk) {
  vec3 s = uSkyLightColor * lcurve(sky * uDaylight) ;
  s = max(s, vec3(lcurve(sky) * uFlash));
  vec3 b = uTorchColor * lcurve(blk);
  return 1.0 - (1.0 - s) * (1.0 - b);
}
`;

const FOG_GLSL = /* glsl */`
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
vec3 applyFog(vec3 c, float d) {
  float f = smoothstep(uFogNear, uFogFar, d);
  return mix(c, uFogColor, f);
}
`;

// ------------------------------------------------------------------ chunks
const CHUNK_VS = /* glsl */`
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
uniform float uWind;
in vec4 position;
in vec4 aTex;
in vec4 aCol;
in vec4 aLight;
out vec3 vUv;
flat out float vOverlay;
out vec3 vTint;
out float vShade;
out vec2 vLight;
out float vAO;
out float vDist;
void main() {
  vec3 p = position.xyz / 1024.0 - 1.0;
  float u = mod(position.w, 32.0) / 16.0;
  float v = floor(position.w / 32.0) / 16.0;
  vec4 world = modelMatrix * vec4(p, 1.0);
  if (aTex.w > 0.5) {
    float t = uTime * 1.7 + world.x * 0.37 + world.z * 0.29;
    float amp = 0.055 * uWind;
    world.x += sin(t) * amp;
    world.z += cos(t * 0.83) * amp;
  }
  float layer = aTex.x;
  if (aTex.z > 1.5) {
    float fps = aTex.z > 31.0 ? 16.0 : 8.0;
    layer += mod(floor(uTime * fps), aTex.z);
  }
  vUv = vec3(u, v, layer);
  vOverlay = aTex.y;
  vTint = aCol.rgb;
  vShade = aCol.a;
  vLight = aLight.xy / 16.0;
  vAO = aLight.z;
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vDist = length(world.xz - cameraPosition.xz);
}
`;

const CHUNK_FS = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uAlphaTest;
uniform float uAlphaMul;
in vec3 vUv;
flat in float vOverlay;
in vec3 vTint;
in float vShade;
in vec2 vLight;
in float vAO;
in float vDist;
out vec4 fragColor;
${LIGHT_GLSL}
${FOG_GLSL}
void main() {
  vec4 c = texture(uAtlas, vUv);
  if (c.a < uAlphaTest) discard;
  if (vOverlay > 0.5) {
    vec4 o = texture(uAtlas, vec3(vUv.xy, vOverlay - 1.0));
    c.rgb = mix(c.rgb, o.rgb * vTint, o.a);
  } else {
    c.rgb *= vTint;
  }
  float ao = 0.5 + vAO * 0.1667;
  vec3 col = c.rgb * vShade * ao * lightmap(vLight.x, vLight.y);
  col = applyFog(col, vDist);
  fragColor = vec4(col, uAlphaTest > 0.0 ? 1.0 : c.a * uAlphaMul);
}
`;

export function chunkMaterials(atlas) {
  const mk = (opts) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CHUNK_VS,
    fragmentShader: CHUNK_FS,
    uniforms: {
      ...U,
      uAtlas: { value: atlas },
      uAlphaTest: { value: opts.alphaTest || 0 },
      uAlphaMul: { value: opts.alphaMul || 1 },
    },
    transparent: !!opts.transparent,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  return [
    mk({}),
    mk({ alphaTest: 0.5 }),
    mk({ transparent: true, alphaMul: 0.78 }),
  ];
}

// ------------------------------------------------------------------ entities / items
// Standard geometry (position/uv/normal). Light comes from per-object uniforms.
const ENT_VS = /* glsl */`
varying vec2 vUv;
varying float vShade;
varying float vDist;
void main() {
  vUv = uv;
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vShade = 0.62 + 0.38 * max(n.y, 0.0) + 0.18 * abs(n.z) - 0.12 * max(-n.y, 0.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDist = length(world.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
const ENT_FS = /* glsl */`
uniform sampler2D uMap;
uniform vec2 uLight;
uniform vec4 uOverlay;
uniform vec3 uColor;
uniform float uAlphaTest;
uniform float uFullbright;
varying vec2 vUv;
varying float vShade;
varying float vDist;
${LIGHT_GLSL}
${FOG_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < uAlphaTest) discard;
  vec3 lit = mix(lightmap(uLight.x, uLight.y), vec3(1.0), uFullbright);
  vec3 col = c.rgb * uColor * mix(vShade, 1.0, uFullbright) * lit;
  col = mix(col, uOverlay.rgb, uOverlay.a);
  col = applyFog(col, vDist);
  gl_FragColor = vec4(col, c.a);
}
`;

export function entityMaterial(map, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: ENT_VS,
    fragmentShader: ENT_FS,
    uniforms: {
      ...U,
      uMap: { value: map },
      uLight: { value: new THREE.Vector2(15, 0) },
      uOverlay: { value: new THREE.Vector4(1, 0, 0, 0) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uAlphaTest: { value: opts.alphaTest ?? 0.1 },
      uFullbright: { value: opts.fullbright ? 1 : 0 },
    },
    transparent: !!opts.transparent,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
    polygonOffset: !!opts.polygonOffset,
    polygonOffsetFactor: opts.polygonOffset ? -1 : 0,
    polygonOffsetUnits: opts.polygonOffset ? -1 : 0,
  });
}

// block-model items (dropped blocks, held blocks) use the chunk shader with uniform light
const ITEMBLOCK_VS = CHUNK_VS.replace('vLight = aLight.xy / 16.0;', 'vLight = uItemLight;')
  .replace('uniform float uWind;', 'uniform float uWind;\nuniform vec2 uItemLight;')
  .replace('vec4 world = modelMatrix * vec4(p, 1.0);', 'vec4 world = modelMatrix * vec4(p - uCenter, 1.0);')
  .replace('uniform vec2 uItemLight;', 'uniform vec2 uItemLight;\nuniform vec3 uCenter;')
  .replace('if (aTex.w > 0.5)', 'if (false)');
export function itemBlockMaterial(atlas, opts = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: ITEMBLOCK_VS,
    fragmentShader: CHUNK_FS,
    uniforms: {
      ...U,
      uAtlas: { value: atlas },
      uAlphaTest: { value: 0.5 },
      uAlphaMul: { value: 1 },
      uItemLight: { value: new THREE.Vector2(15, 0) },
      uCenter: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    },
    depthTest: opts.depthTest ?? true,
    side: THREE.FrontSide,
  });
}

// ------------------------------------------------------------------ particles
// instanced billboards; per-instance: position, size, layer + uv rect, colour, light
const PART_VS = /* glsl */`
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec4 iPos;    // xyz, size
in vec4 iTex;    // layer, u0, v0, uvSize (in 0..1)
in vec4 iCol;    // rgb, alpha
in vec2 iLight;
out vec3 vUv;
out vec4 vCol;
out vec2 vLight;
out float vDist;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = iPos.xyz + (right * position.x + up * position.y) * iPos.w;
  vUv = vec3(iTex.y + (position.x + 0.5) * iTex.w, iTex.z + (0.5 - position.y) * iTex.w, iTex.x);
  vCol = iCol;
  vLight = iLight;
  vDist = length(wp.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const PART_FS = /* glsl */`
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
in vec3 vUv;
in vec4 vCol;
in vec2 vLight;
in float vDist;
out vec4 fragColor;
${LIGHT_GLSL}
${FOG_GLSL}
void main() {
  vec4 c = texture(uAtlas, vUv);
  if (c.a < 0.4) discard;
  vec3 col = c.rgb * vCol.rgb * (vLight.x < 0.0 ? vec3(1.0) : lightmap(vLight.x, vLight.y));
  fragColor = vec4(applyFog(col, vDist), vCol.a);
}
`;
export function particleMaterial(atlas) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PART_VS,
    fragmentShader: PART_FS,
    uniforms: { ...U, uAtlas: { value: atlas } },
    transparent: true,
    depthWrite: false,
  });
}
