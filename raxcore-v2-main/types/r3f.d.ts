// Global JSX augmentation for React Three Fiber intrinsic elements.
// Suppresses "does not exist on type JSX.IntrinsicElements" TS errors
// that occur when tsc runs without the R3F global augmentation in scope.
// At runtime these are fully valid R3F JSX elements.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        // Lights
        ambientLight: any
        directionalLight: any
        pointLight: any
        spotLight: any
        hemisphereLight: any
        rectAreaLight: any
        // Mesh & groups
        mesh: any
        group: any
        primitive: any
        instancedMesh: any
        skinnedMesh: any
        line: any
        lineSegments: any
        lineLoop: any
        points: any
        // Geometries
        boxGeometry: any
        planeGeometry: any
        sphereGeometry: any
        cylinderGeometry: any
        coneGeometry: any
        torusGeometry: any
        tubeGeometry: any
        bufferGeometry: any
        // Materials
        meshStandardMaterial: any
        meshBasicMaterial: any
        meshPhysicalMaterial: any
        meshLambertMaterial: any
        meshPhongMaterial: any
        shadowMaterial: any
        lineBasicMaterial: any
        pointsMaterial: any
        // Misc
        fog: any
        fogExp2: any
        color: any
        axesHelper: any
        gridHelper: any
      }
    }
  }
}

export {}
