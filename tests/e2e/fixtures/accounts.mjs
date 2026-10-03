// Fictitious pre-existing Supabase Local QA accounts only. Never production.
// La contraseña de las cuentas ficticias QA de Supabase Local NO se versiona (repo público):
// se entrega por entorno del proceso, p. ej. $env:QA_TEST_PASSWORD='...' antes de ejecutar.
export const password = process.env.QA_TEST_PASSWORD ?? '';
if (!password) throw new Error('Define QA_TEST_PASSWORD (contraseña de las cuentas QA locales) antes de ejecutar la suite.');
export const accounts = {
  ADMINISTRADOR: 'administradortest01@test.local',
  CAJERA: 'cajeratest01@test.local',
  ASISTENTE: 'asistentetest01@test.local',
};
export const issueURLs = {
  'QA-033': 'https://app.notion.com/p/3eef27109e6a8173a6a9e13e177cdd19',
  'QA-034': 'https://app.notion.com/p/3eef27109e6a81ea9020c1db9098e356',
  'QA-020': 'https://app.notion.com/p/3edf27109e6a81268400df6bb0d19170',
  'QA-021': 'https://app.notion.com/p/3edf27109e6a8156b9fef7cb91be645d',
  'QA-022': 'https://app.notion.com/p/3edf27109e6a81e0bbe1d0511bfec5a4',
  'QA-023': 'https://app.notion.com/p/3edf27109e6a8124bdeaefce568dd181',
  'QA-024': 'https://app.notion.com/p/3edf27109e6a81d6868adb65e23a76bf',
  'QA-030': 'https://app.notion.com/p/3edf27109e6a8172ad91d080092143ec',
  'QA-031': 'https://app.notion.com/p/3edf27109e6a8151a2c4cc2aef957557',
  'QA-032': 'https://app.notion.com/p/3edf27109e6a813bb999fd28f71c7d72',
  'QA-025': 'https://app.notion.com/p/3edf27109e6a81e8b88bf76ba8ee67e4',
  'QA-026': 'https://app.notion.com/p/3edf27109e6a81568275e3d7537f9950',
  'QA-027': 'https://app.notion.com/p/3edf27109e6a814b80d7dfdaa23f0982',
  'QA-028': 'https://app.notion.com/p/3edf27109e6a81e1bf0ce4c981d43cce',
  'QA-029': 'https://app.notion.com/p/3edf27109e6a810e883bd938d0ce3a89',
  'QA-019': 'https://app.notion.com/p/3ecf27109e6a8184a7d3f35bac155bbf',
  'QA-018': 'https://app.notion.com/p/3ecf27109e6a8172b081c094d18ab638',
  'QA-016': 'https://app.notion.com/p/3ecf27109e6a81bea359d72af4c87375',
  'QA-017': 'https://app.notion.com/p/3ecf27109e6a81bd8ac6f53ebed10d1a',
  'QA-015': 'https://app.notion.com/p/3ecf27109e6a81a6a71dd90e260d9cba',
  'QA-001': 'https://app.notion.com/p/3ebf27109e6a81bda3ecdd7b578f3a42',
  'QA-003': 'https://app.notion.com/p/3ebf27109e6a811d94eaecd91c5f78cd',
  'QA-004': 'https://app.notion.com/p/3ebf27109e6a81a7b70af29282811472',
  'QA-005': 'https://app.notion.com/p/3ebf27109e6a81a1af38eb22d452e10c',
  'QA-006': 'https://app.notion.com/p/3ebf27109e6a811faea4cb2e99073370',
  'QA-007': 'https://app.notion.com/p/3ebf27109e6a81249f5fc0dcb615e7ce',
  'QA-008': 'https://app.notion.com/p/3ebf27109e6a8190a3d8fd6e393ca857',
  'QA-009': 'https://app.notion.com/p/3ebf27109e6a8109868fd483190f9313',
  'QA-010': 'https://app.notion.com/p/3ebf27109e6a81889c50c3b04bda6296',
  'QA-011': 'https://app.notion.com/p/3ebf27109e6a81468a6df005377ba230',
  'QA-012': 'https://app.notion.com/p/3ecf27109e6a8134ada9ef43123e5529',
  'QA-013': 'https://app.notion.com/p/3ecf27109e6a81eca3bfec08dde5cfaa',
  'QA-014': 'https://app.notion.com/p/3ecf27109e6a8120b706de9f773efc21',
};
