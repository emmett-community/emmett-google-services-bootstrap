Feature: Dependency Management
  As a service developer
  I want to verify all required services are available before starting
  So that my service doesn't fail unexpectedly after startup

  Background:
    Given a service with external dependencies

  Scenario: All dependencies available
    Given all required services are running and accessible
    When I start my service
    Then the service should verify each dependency is working
    And the service should start successfully
    And I should see confirmation that all dependencies are healthy

  Scenario: Missing dependency detected at startup
    Given one of the required services is not available
    When I attempt to start my service
    Then the service should identify which dependency is missing
    And the service should provide a helpful error message
    And the service should not start in a degraded state

  Scenario: Dependency becomes unavailable during operation
    Given the service is running normally
    When a required service becomes unavailable
    Then the service should detect the issue
    And the service should report the problem
    And the service should attempt to reconnect automatically

  Scenario: Dependency check with custom health verification
    Given I have defined custom checks for my dependencies
    When the service performs dependency verification
    Then my custom checks should be executed
    And the results should be included in the health report
