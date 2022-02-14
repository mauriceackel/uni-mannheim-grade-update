import axios from "axios";
import { region } from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import qs from "qs";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { JSDOM } from "jsdom";
import { addedDiff } from "deep-object-diff";
import { decode as htmlDecode } from "html-entities";
import { username, password, pushToken, pushUser, includeGrades } from "./config";

const firestore = getFirestore();

export const checkGrades = region("europe-west3")
  .pubsub.schedule("0 12 * * *") // https://crontab.guru/#0_12_*_*_*
  .timeZone("Europe/Berlin")
  .onRun(onCheckGrades);

async function onCheckGrades() {
  // Setting up cookies
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar }));

  console.log("------------- Starting Execution -------------");

  // Perform request to get login tokens
  console.log("Performing initial login request...");
  const sessionIdResponse = await client.get(
    "https://cas.uni-mannheim.de/cas/login",
    {
      params: {
        service:
          "https://portal2.uni-mannheim.de/portal2/rds?state=user&type=1",
      },
      withCredentials: true,
    }
  );
  console.log("Request successful!");

  // Get session ID
  console.log("Extracting session ID...");
  const sessionIdHeader = sessionIdResponse.headers["set-cookie"];
  if (sessionIdHeader === undefined) {
    throw new Error("No session id header");
  }

  const [headerName, sessionId] = sessionIdHeader[0].split(";")[0].split("=");
  if (headerName !== "JSESSIONID" || sessionId === undefined) {
    throw new Error("No session ID");
  }

  // Get XSRF token
  console.log("Extracting XSRF token...");
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
  console.log("Extracting worker node...");
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
  console.log("Performing authentication request...");
  await client.post(
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
      params: {
        service:
          "https://portal2.uni-mannheim.de/portal2/rds?state=user&type=1",
      },
      withCredentials: true,
    }
  );
  console.log("Request successful!");

  // Data overview call
  console.log("Performing overview request...");
  const overviewResponse = await client.get(
    "https://portal2.uni-mannheim.de/portal2/rds",
    {
      params: {
        state: "change",
        type: 1,
        moduleParameter: "studyPOSMenu",
        nextdir: "change",
        next: "menu.vm",
        subdir: "applications",
        xml: "menu",
        purge: "y",
        navigationPosition: "hisinoneMeinStudium,studyPOSMenu",
        recordRequest: true,
        breadcrumb: "studyPOSMenu",
        subitem: "studyPOSMenu",
        topitem: "hisinoneMeinStudium",
      },
      withCredentials: true,
    }
  );
  console.log("Request successful!");

  // Get link to transcript selection page
  console.log("Extracting temporary link to transcript selection page...");
  const transcriptSelectionLinkEndIndex = overviewResponse.data.indexOf(
    '"  title="" class="auflistung">Notenspiegel</a>'
  );
  const transcriptSelectionLinkStartIndex = overviewResponse.data.lastIndexOf(
    '<a href="',
    transcriptSelectionLinkEndIndex
  );

  const transcriptSelectionLinkString = htmlDecode(
    overviewResponse.data.substring(
      transcriptSelectionLinkStartIndex + 9,
      transcriptSelectionLinkEndIndex
    )
  );
  const transcriptSelectionLink = new URL(transcriptSelectionLinkString);

  console.log("Extracting ASI value...");
  const asi = transcriptSelectionLink.searchParams.get("asi");
  if (asi === undefined) {
    throw new Error("No ASI value");
  }

  // Get link to transcript
  console.log("Performing selection request...");
  const selectionRequest = await client.get(transcriptSelectionLinkString, {
    withCredentials: true,
  });
  console.log("Request successful!");

  console.log("Extracting temporary link to transcript page...");
  const transcriptLinkEndIndex = selectionRequest.data.indexOf(
    "Notenspiegel Ihres aktuellen Studiengangs anzeigen"
  );
  const transcriptLinkStartIndex = selectionRequest.data.lastIndexOf(
    '<a href="',
    transcriptLinkEndIndex
  );
  const transcriptLink = htmlDecode(
    selectionRequest.data.substring(
      transcriptLinkStartIndex + 9,
      transcriptLinkEndIndex - 128
    )
  );

  // Perform data call
  console.log("Performing data request...");
  const dataResponse = await client.get(transcriptLink, {
    withCredentials: true,
  });
  console.log("Request successful!");

  // Parse transcript
  console.log("Parsing transcript DOM");
  const dom = new JSDOM(dataResponse.data);
  const gradeTable = dom.window.document.querySelector(
    "#wrapper > div.divcontent > div:nth-child(1) > form > table:nth-child(7) > tbody"
  );
  if (gradeTable === null) {
    throw new Error("Grade table not found");
  }

  console.log("Extracting grades from DOM");
  const parsedGrades: Record<string, number> = {};
  for (let i = 1; true; i++) {
    const row = gradeTable.querySelector(`tr:nth-child(${i})`);
    if (row === null) break;

    const courseNameElement = row.querySelector("td:nth-child(1)");
    const gradeElement = row.querySelector(`td:nth-child(4)`);
    if (courseNameElement === null || gradeElement === null) continue;

    const courseName = courseNameElement.textContent?.trim();
    const grade = gradeElement.textContent
      ? Number.parseFloat(gradeElement.textContent.trim().replace(/,/g, "."))
      : undefined;
    if (courseName === undefined || grade === undefined) continue;

    parsedGrades[courseName] = grade;
  }
  console.log(`Extracted grades: ${JSON.stringify(parsedGrades)}`);

  // Compute diff of last grades with current grades
  console.log(
    "Computing diff between extracted grades and last extracted grade"
  );
  const currentGradesSnapshot = await firestore
    .doc("grades/currentGrades")
    .get();
  const currentGrades = currentGradesSnapshot.data() ?? {};

  const newGrades = addedDiff(currentGrades, parsedGrades);
  const newGradesCount = Object.keys(newGrades).length;
  if (newGradesCount <= 0) {
    // No new grade(s) added
    console.log("No new grades, aborting for now");
    return;
  }

  // Store new grades
  console.log("New grades found!");
  console.log("Overwriting last stored grades");
  await firestore.doc("grades/currentGrades").set(parsedGrades);

  // Send push notifications
  console.log("Sending push notification");
  const message = Object.entries(newGrades).map(([courseName, grade]) => {
    if (includeGrades) {
        return `${courseName}: ${grade}`;
    }
    return courseName;
  }).join('\n');
  await axios.post("https://api.pushover.net/1/messages.json", {
    user: pushUser,
    token: pushToken,
    title: `New grade${newGradesCount > 1 ? "s" : ""} added`,
    message,
  });

  console.log("Finished execution");
}
