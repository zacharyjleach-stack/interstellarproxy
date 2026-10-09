// Password protection is enabled only when AUTH_USER and AUTH_PASS are set in the environment.
const { AUTH_USER, AUTH_PASS } = process.env

const config = {
  challenge: Boolean(AUTH_USER && AUTH_PASS),
  users: AUTH_USER && AUTH_PASS ? { [AUTH_USER]: AUTH_PASS } : {},
  routes: true, // Change this to false if you just want to host a bare server.
  local: true, // Change this to false to disable local assets.
}
export default config
