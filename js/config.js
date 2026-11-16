/**
 * config.js — Configuración pública del frontend.
 *
 * SUPABASE_URL y SUPABASE_ANON_KEY son datos PÚBLICOS (la clave "anon" está pensada
 * para usarse en el navegador; la seguridad la dan las políticas RLS y las funciones SQL).
 * NUNCA pongas aquí la clave "service_role" ni contraseñas.
 *
 * Si se dejan vacíos, el juego funciona en MODO LOCAL (ranking solo de este dispositivo).
 * En Vercel/Netlify este archivo puede generarse con `node scripts/build-config.mjs`
 * a partir de las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY.
 */
export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  /** Si Supabase está configurado pero no responde, ¿permitir jugar en modo local? */
  OFFLINE_FALLBACK: true,
};
