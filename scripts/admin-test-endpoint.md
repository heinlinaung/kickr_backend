# ENDPOINT for testing group, location, event, and team functionalities
- expose as a new admin enpoint for testing purposes, accessible only to admin users
- the request must accept user email prefix (eg. 'test') and postfix (eg. '@example.com') as input parameters
- scan existing users first, if user exists, reject creation and log the error, else create the user
- don't clean up the created users, groups, locations, events, and teams after the execution to allow for manual verification of the created data
- add option to clean up the created data after manual verification if needed (may be we need testId(uuid) to identify the created data - may be use a new schema to store the testId and created data for cleanup)
- add option for full test or partial test
  - full test: create all users, group, locations, event, and teams, and test all functionalities
  - partial test: create only users and group, and test only group functionalities

## seed data for testing
- create a total of 22 users (with different roles: owner, captain, admin, member) using the provided email prefix and postfix
- owner: 1 user, captain: 2 users, admin: 3 users, member: 16 users

### Group and location setup
- create a group using owner email account
- create 3 locations for the group
- assign all 22 users to the group as members
- test success and fail cases for group location creation and update

### Event and team setup
- create an event using the owner email account
- create 2 teams for the event (assume shuffling is done at client side)
- test member join/leave events for the group in each stage of the event lifecycle (e.g., before event creation, during event, after event) - both fail and success cases
- update event result (mvp, scores, etc.)
