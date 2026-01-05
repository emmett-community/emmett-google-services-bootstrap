Feature: Graceful Shutdown
  As a service operator
  I want the service to shut down cleanly when requested
  So that no data is lost and no operations are interrupted mid-process

  Background:
    Given a running service with active connections

  Scenario: Clean shutdown on stop request
    When I request the service to stop
    Then all pending operations should complete
    And all connections should be properly closed
    And the service should confirm successful shutdown
    And no error messages should appear

  Scenario: Shutdown with pending messages
    Given there are messages being processed
    When I request the service to stop
    Then the service should finish processing current messages
    And no messages should be lost or duplicated
    And the service should then shut down cleanly

  Scenario: Forced shutdown after timeout
    Given a component is not responding
    When I request the service to stop
    And the graceful shutdown period expires
    Then the service should force close remaining connections
    And the service should log which components did not close properly
    And the service should exit with an error status

  Scenario: Shutdown preserves data integrity
    Given there are business events being recorded
    When I request the service to stop
    Then all recorded events should be fully saved
    And no partial records should exist in storage
