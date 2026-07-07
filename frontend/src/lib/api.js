import axios from "axios";

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = {
  categories: (mode) => axios.get(`${API}/categories`, { params: mode ? { mode } : {} }).then((r) => r.data),
  createRoom: (host_name, mode) =>
    axios.post(`${API}/rooms/create`, { host_name, mode: mode || "classic" }).then((r) => r.data),
  join: (code, name, category_id) =>
    axios.post(`${API}/rooms/join`, { code, name, category_id }).then((r) => r.data),
  spectate: (code, name) =>
    axios.post(`${API}/rooms/spectate`, { code, name }).then((r) => r.data),
  state: (code, token) =>
    axios
      .get(`${API}/rooms/${code}/state`, { params: token ? { token } : {} })
      .then((r) => r.data),
  start: (code, host_token) =>
    axios.post(`${API}/rooms/start`, { code, host_token }).then((r) => r.data),
  attack: (code, player_token, row, col) =>
    axios
      .post(`${API}/rooms/attack`, { code, player_token, row, col })
      .then((r) => r.data),
  answer: (code, player_token, answer_idx) =>
    axios
      .post(`${API}/rooms/answer`, { code, player_token, answer_idx })
      .then((r) => r.data),
  powerup: (code, player_token, powerup, target_row, target_col) =>
    axios
      .post(`${API}/rooms/powerup`, {
        code,
        player_token,
        powerup,
        target_row,
        target_col,
      })
      .then((r) => r.data),
  duelPass: (code, player_token) =>
    axios.post(`${API}/rooms/duel_pass`, { code, player_token }).then((r) => r.data),
  custom: (code, host_token, category_id, q, opts, a) =>
    axios.post(`${API}/rooms/custom_question`, { code, host_token, category_id, q, opts, a }).then((r) => r.data),
  nextTurn: (code, host_token) =>
    axios.post(`${API}/rooms/next_turn`, { code, host_token }).then((r) => r.data),
  tick: (code) => axios.post(`${API}/rooms/tick?code=${code}`).then((r) => r.data),
  voiceToken: (room_id, player_id) =>
    axios.post(`${API}/voice/token`, { room_id, player_id }).then((r) => r.data),
};
