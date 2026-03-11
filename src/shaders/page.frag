// page.frag
// Fragment shader implementing texture selection and front/back face handling from Section 3

uniform sampler2D frontTexture;
uniform sampler2D backTexture;
uniform sampler2D nextPageTexture;
uniform float curlAxisX;
uniform float curlRadius;
uniform float pageWidth;

varying vec2 vUv;
varying float vDistFromAxis;
varying float vTheta;
varying vec3 vPos;

void main() {
  vec2 finalUv = vUv;
  vec4 texColor;
  
  float d = vDistFromAxis;
  
  // Three regions from Section 3 (fragment shader approach)
  if (d < 0.0) {
    // Region 1: Behind curl axis, show next page
    // The next page texture shows what's underneath
    texColor = texture2D(nextPageTexture, vUv);
  } else if (d <= 3.14159265 * curlRadius) {
    // Region 2: On the curl
    // Use gl_FrontFacing to determine if we're looking at front or back
    if (gl_FrontFacing) {
      // Front of curl (theta < pi/2): show current page
      texColor = texture2D(frontTexture, vUv);
    } else {
      // Back of curl (theta > pi/2): show back texture, UV mirrored
      texColor = texture2D(backTexture, vec2(1.0 - vUv.x, vUv.y));
    }
  } else {
    // Region 3: Ahead of curl, show current page
    if (gl_FrontFacing) {
      texColor = texture2D(frontTexture, vUv);
    } else {
      texColor = texture2D(backTexture, vec2(1.0 - vUv.x, vUv.y));
    }
  }
  
  gl_FragColor = texColor;
}
