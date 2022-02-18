# Uni Mannheim Grade Checker

This tool sends you a push notification whenever a new grade is added to your transcript of records.

## Prerequisites
1. In order to receive push notifications, you need to create a [Pushover](https://pushover.net) account and download the Pushover app.
2. In order to deploy the application an run it periodically, you need to have a firebase account (i.e. Google Account).

## Functionality
The goal of this tool is to notify yu whenever a new grade is added to your transcript of records in Portal2 (the intranet of the University of Mannheim). This is achieved in the following way:
1. The tool signs in at the CAS with your provided credentials
2. All required temporary tokens are extracted
3. The tool requests the transcript of record page for your **current** degree program
4. The transcript is parsed and all course names and grades are extracted
5. The tool compares the current list of grades to the list from the previous execution (this is done by storing the extracted grades in firestore)
6. If there was no change, the tool aborts the current execution
7. If new grades are detected, the tool sends you a push notification via Pushover
   - By default, grades are not included in the push notification. You can decide to include them in the push notifications by setting the `includeGrades` flag in the firebase function config

## Deployment
To deploy this tool, you need to setup a firebase project.

1. Create a new firebase project via the firebase console
2. Enable `firestore` and `functions`
3. Upgrade to the `Blaze` plan (this tool should not cost more than a few cents per month)
4. INstall global dependencies by running `npm i` in the root folder
5. Install project dependencies by running `npm i` inside the `./functions` folder
6. Configure firebase cli by updating the project id inside the `.firebaserc` file so it matches the ID of the project you created above
7. Deploy firebase function config by running `./functions/set-config.js` (requires node v16)
8. Deploy app by running `npx firebase deploy` from the root directory
