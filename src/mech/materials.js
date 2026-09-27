/**
 * Engineering materials. Density kg/m³, modulus GPa, yield (or ultimate for brittle/plastics) MPa,
 * Poisson ratio, friction coefficient against steel (dry), display colour.
 */
export const MATERIALS = {
  steel: { name: 'Steel (mild)', rho: 7850, E: 205, yield: 250, nu: 0.29, mu: 0.6, color: 0x9aa3ad },
  'steel-hard': { name: 'Steel (hardened 4140)', rho: 7850, E: 205, yield: 655, nu: 0.29, mu: 0.6, color: 0x7f8894 },
  stainless: { name: 'Stainless 304', rho: 8000, E: 193, yield: 215, nu: 0.29, mu: 0.55, color: 0xb9c1c9 },
  aluminum: { name: 'Aluminium 6061', rho: 2700, E: 69, yield: 275, nu: 0.33, mu: 0.6, color: 0xc4cad1 },
  brass: { name: 'Brass', rho: 8500, E: 100, yield: 200, nu: 0.34, mu: 0.35, color: 0xd6b25e },
  bronze: { name: 'Bronze', rho: 8800, E: 110, yield: 240, nu: 0.34, mu: 0.3, color: 0xb98a4e },
  copper: { name: 'Copper', rho: 8960, E: 117, yield: 70, nu: 0.34, mu: 0.5, color: 0xd98858 },
  'cast-iron': { name: 'Cast iron', rho: 7200, E: 110, yield: 130, nu: 0.26, mu: 0.4, color: 0x6b7078 },
  titanium: { name: 'Titanium Ti-6Al-4V', rho: 4430, E: 114, yield: 880, nu: 0.34, mu: 0.4, color: 0xa8aeb8 },
  nylon: { name: 'Nylon (PA6)', rho: 1140, E: 2.8, yield: 70, nu: 0.39, mu: 0.25, color: 0xe8e3d0 },
  delrin: { name: 'Acetal (Delrin)', rho: 1410, E: 3.1, yield: 66, nu: 0.35, mu: 0.2, color: 0xf1f1ee },
  abs: { name: 'ABS plastic', rho: 1050, E: 2.2, yield: 40, nu: 0.35, mu: 0.35, color: 0xe4d24a },
  pla: { name: 'PLA (3D print)', rho: 1240, E: 3.5, yield: 50, nu: 0.36, mu: 0.4, color: 0x63b8ff },
  petg: { name: 'PETG (3D print)', rho: 1270, E: 2.1, yield: 50, nu: 0.38, mu: 0.4, color: 0x7fd6a8 },
  wood: { name: 'Oak wood', rho: 750, E: 11, yield: 40, nu: 0.3, mu: 0.4, color: 0xa9803f },
  plywood: { name: 'Plywood', rho: 600, E: 8, yield: 30, nu: 0.3, mu: 0.4, color: 0xc9a86a },
  rubber: { name: 'Rubber', rho: 1100, E: 0.05, yield: 15, nu: 0.49, mu: 0.9, color: 0x2b2b2e },
  carbon: { name: 'Carbon fibre composite', rho: 1600, E: 70, yield: 600, nu: 0.3, mu: 0.3, color: 0x2e3238 },
  glass: { name: 'Glass', rho: 2500, E: 70, yield: 50, nu: 0.22, mu: 0.4, color: 0x9fd7e8 },
};
export const materialOf = (key) => MATERIALS[key] ?? MATERIALS.steel;
export const materialOptions = () => Object.entries(MATERIALS).map(([value, m]) => ({ value, label: m.name }));
