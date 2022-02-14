import { config } from "firebase-functions";

const env = config();

export const username = env.general.username;
export const password = env.general.password;

export const pushUser = env.general.push_user;
export const pushToken = env.general.push_token;

export const includeGrades = env.general.include_grades === 'true';
console.log(includeGrades === true);
