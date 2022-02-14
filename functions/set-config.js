#!/usr/bin/env node

const readline = require("readline");
const { exec } = require('child_process');
const util = require("util");
const { stdin, stdout } = require("process");

const rl = readline.createInterface({ input: stdin, output: stdout });
const question = util.promisify(rl.question).bind(rl);

async function main() {
  const username = await question("Enter your username: ");
  const password = await question("Enter your password: ");

  const pushUser = await question("Enter your pushover user ID: ");
  const pushToken = await question("Enter your pushover API token: ");

  const includeGradesString = await question("Include grades in push notification? (y/n): ");
  let includeGrades = false;
  switch(includeGradesString) {
      case 'y': includeGrades = true; break;
      case 'n': includeGrades = false; break;
      default: throw new Error('Enter either "y" or "n"');
  }

  const config = {
    'general.username': username,
    'general.password': password,
    'general.push_user': pushUser,
    'general.push_token': pushToken,
    'general.include_grades': includeGrades,
  };

  const stringified = Object.entries(config)
    .map(([key, value]) => `"${key}"="${value}"`)
    .join(" ");
  const command = `firebase functions:config:set ${stringified}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`Error: ${error.message}`);
      process.exit(1);
    }
    if (stderr) {
      console.log(`Stderr: ${stderr}`);
      process.exit(1);
    }
    console.log("Success!");
    process.exit(0);
  });
}

try {
  main();
} catch (err) {
  console.log("An error occurred");
}
