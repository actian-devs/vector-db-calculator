import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat configs, so no FlatCompat shim.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: ['out/**', '.next/**', 'node_modules/**', 'next-env.d.ts'] },
];

export default config;
