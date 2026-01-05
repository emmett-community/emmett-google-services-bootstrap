Feature: Service Initialization
  As a service developer
  I want my service to start up with all required components ready
  So that I can focus on building business features instead of infrastructure

  Background:
    Given a service configuration with a valid name and project settings

  Scenario: Successful service startup
    When I initialize the service
    Then the data storage should be ready to accept requests
    And the messaging system should be ready to send and receive messages
    And the event recording system should be ready to capture business events
    And a confirmation message should indicate the service is running

  Scenario: Service startup with custom settings
    Given I have specified custom connection settings
    When I initialize the service
    Then the service should use my custom settings
    And all components should connect to the specified locations

  Scenario: Service startup in development mode
    Given the development environment is configured
    When I initialize the service
    Then the service should connect to local development tools
    And no production systems should be affected

  Scenario: Service startup failure due to missing configuration
    Given required configuration is missing
    When I attempt to initialize the service
    Then the service should report what configuration is missing
    And the service should not start in an incomplete state
