// page.vert
// Vertex shader implementing the cylinder-curl geometry from Section 2 of the formalization

uniform float curlAxisX;     // x_axis(phi), sweeps from pageWidth to -pageWidth
uniform float curlRadius;    // cylinder radius r
uniform float pageWidth;     // W, page width in world units

varying vec2 vUv;
varying float vDistFromAxis;
varying float vTheta;
varying vec3 vPos;

void main() {
  vUv = uv;
  
  vec3 pos = position;
  float d = pos.x - curlAxisX;
  
  vDistFromAxis = d;
  vTheta = 0.0;
  
  // Three cases from Section 2.3
  if (d < 0.0) {
    // Case 1: Behind curl axis, already turned
    // Mirror across curl axis, slight z offset to avoid z-fighting
    pos.x = 2.0 * curlAxisX - pos.x;
    pos.z = 0.001;
    vTheta = -1.0; // marker for "already turned"
  } else if (d <= 3.14159265 * curlRadius) {
    // Case 2: On the cylinder
    // Wrap around cylinder
    float theta = d / curlRadius;
    vTheta = theta;
    
    pos.x = curlAxisX + curlRadius * sin(theta);
    pos.z = curlRadius * (1.0 - cos(theta));
    // y unchanged
  } 
  // Case 3: Ahead of curl (d > pi*r), vertex stays unchanged
  
  vPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
