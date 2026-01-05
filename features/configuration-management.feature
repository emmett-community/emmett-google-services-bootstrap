Feature: Configuration Management
  As a service operator
  I want the service to be easily configurable
  So that I can adapt it to different environments without code changes

  Background:
    Given I have a service to configure

  Scenario: Configure service using environment variables
    Given environment variables are set for my infrastructure
    When I start the service without explicit configuration
    Then the service should use values from the environment
    And no hardcoded values should be required

  Scenario: Override environment with explicit configuration
    Given environment variables have default values
    And I provide explicit configuration values
    When I start the service
    Then my explicit values should take precedence
    And environment values should be used as fallbacks

  Scenario: Validate required configuration
    Given some required values are not provided
    When I attempt to start the service
    Then the service should list all missing required values
    And the service should suggest how to provide them
    And the service should not start partially configured

  Scenario: Configuration for different environments
    Given I have separate configurations for development and production
    When I deploy the service to either environment
    Then the service should automatically use the appropriate settings
    And development settings should never be used in production
