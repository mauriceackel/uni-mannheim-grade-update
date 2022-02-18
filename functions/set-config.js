#!/usr/bin/env node

const readline = require("readline");
const axios = require("axios").default;
const qs = require("qs");
const { wrapper } = require("axios-cookiejar-support");
const { exec } = require("child_process");
const { CookieJar } = require("tough-cookie");
const util = require("util");
const { stdin, stdout } = require("process");

const rl = readline.createInterface({ input: stdin, output: stdout });
const question = util.promisify(rl.question).bind(rl);

async function testCas(username, password) {
  console.log("- Testing CAS login");

  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));

  // Perform request to get login tokens
  try {
    const sessionIdResponse = await client.get(
      "https://cas.uni-mannheim.de/cas/login",
      {
        withCredentials: true,
      }
    );

    // Get session ID
    const sessionIdHeader = sessionIdResponse.headers["set-cookie"];
    if (sessionIdHeader === undefined) {
      throw new Error("No session id header");
    }

    const [headerName, sessionId] = sessionIdHeader[0].split(";")[0].split("=");
    if (headerName !== "JSESSIONID" || sessionId === undefined) {
      throw new Error("No session ID");
    }

    // Get XSRF token
    const tokenStartIndex = sessionIdResponse.data.indexOf(
      '<input type="hidden" name="lt" value="'
    );
    const tokenEndIndex = sessionIdResponse.data.indexOf(
      '"',
      tokenStartIndex + 38
    );
    const token = sessionIdResponse.data.substring(
      tokenStartIndex + 38,
      tokenEndIndex
    );

    // Get execution worker
    const workerStartIndex = sessionIdResponse.data.indexOf(
      '<input type="hidden" name="execution" value="'
    );
    const workerEndIndex = sessionIdResponse.data.indexOf(
      '"',
      workerStartIndex + 45
    );
    const worker = sessionIdResponse.data.substring(
      workerStartIndex + 45,
      workerEndIndex
    );

    // Perform auth call
    const response = await client.post(
      `https://cas.uni-mannheim.de/cas/login;jsessionid=${sessionId}`,
      qs.stringify({
        username,
        password,
        _eventId: "submit",
        submit: "Anmelden",
        execution: worker,
        lt: token,
      }),
      {
        withCredentials: true,
      }
    );

    if (response.data.includes("The credentials you provided cannot be determined to be authentic")) {
      throw new Error();
    }
  } catch (err) {
    console.log("- Auth test failed");
    return false;
  }

  console.log("- Auth request successful!");
  return true;
}

async function testPushover(username, token) {
  console.log("- Testing Pushover login");

  try {
    await axios.post("https://api.pushover.net/1/messages.json", {
      user: username,
      token: token,
      title: "Test",
      message: "Test notification",
    });
  } catch (err) {
    console.log("- Pushover test failed");
    return false;
  }

  console.log("- Pushover test successful");
  return true;
}

async function main() {
  const username = await question("Enter your username: ");
  const password = await question("Enter your password: ");
  rl.history = rl.history.slice(1);

  const pushUser = await question("Enter your pushover user ID: ");
  const pushToken = await question("Enter your pushover API token: ");
  rl.history = rl.history.slice(1);

  let includeGrades = true;
  const includeGradesString = await question(
    "Include grades in push notification? (Y/n): "
  );
  if (includeGradesString === "n") {
    includeGrades = false;
  }

  const config = {
    "general.username": username,
    "general.password": password,
    "general.push_user": pushUser,
    "general.push_token": pushToken,
    "general.include_grades": includeGrades,
  };

  const testConfig = await question(
    "Do you want to test the config now? (Y/n): "
  );
  if (testConfig !== "n") {
    console.log("Testing config now...");

    if (
      !(await testCas(username, password)) ||
      !(await testPushover(pushUser, pushToken))
    ) {
      console.log("Aborting now!");
    }
  } else {
    console.log("Not testing config...");
  }

  const stringified = Object.entries(config)
    .map(([key, value]) => `"${key}"="${value}"`)
    .join(" ");
  const command = `firebase functions:config:set ${stringified}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      throw new Error(error.message);
    }
    if (stderr) {
      throw new Error(stderr);
    }
    console.log("Success!");
  });
}

main()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.log("An error occurred", err);
    process.exit(1);
  });
