Run all automated cases with `npm test`.

Run coverage with `node --test --experimental-test-coverage`.

The suite covers login credential validation and company identity, project routing
and API documentation, controller input validation, company ownership checks,
stages, task types, discussions, membership, messages, SQL parameter binding,
transaction commit/rollback, attachment validation and cleanup, response helpers,
encryption helpers, and concurrent database context isolation.

Database queries use driver doubles. HTTP checks use a temporary localhost server.
These tests do not prove that SQL executes against a deployed schema. Real SQL
Server connection/reconnection, database-backed login/session persistence, and
migration execution require a separate disposable database integration environment.
