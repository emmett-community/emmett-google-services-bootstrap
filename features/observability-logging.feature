Feature: Observability and Logging
  As a service operator
  I want comprehensive visibility into service behavior
  So that I can monitor health and troubleshoot issues

  Background:
    Given the service is running

  Scenario: Startup logging
    When the service starts
    Then I should see clear messages about each initialization step
    And I should know when the service is ready to accept requests
    And no sensitive information should appear in logs

  Scenario: Error logging with context
    Given an error occurs during operation
    When the error is logged
    Then the log should include what operation was attempted
    And the log should include relevant identifiers
    And the log should suggest possible causes or solutions

  Scenario: Request tracing
    Given multiple related operations are happening
    When I review the logs
    Then I should be able to trace related operations together
    And I should see the sequence of events clearly

  Scenario: Health check availability
    Given the service is running
    When I query the health status
    Then I should see the status of each component
    And I should know if any component is degraded
    And the response should be quick even under load
