Feature: Event Store Integration
  As a service developer
  I want business events to be automatically stored and projected
  So that I can track what happened in my system and query current state

  Background:
    Given the service is configured with event storage

  Scenario: Recording a business event
    Given a business action has occurred
    When the event is recorded
    Then the event should be stored permanently
    And the event should include when it happened
    And the event should include what changed
    And the event should be retrievable later

  Scenario: Projecting events to queryable views
    Given business events have been recorded
    When the projection system processes these events
    Then a current-state view should be updated
    And the view should reflect all recorded events
    And the view should be queryable in real-time

  Scenario: Event replay for new projections
    Given historical events exist in the system
    When I add a new view of the data
    Then all historical events should be processed
    And the new view should reflect the complete history
    And no events should be skipped

  Scenario: Concurrent event recording
    Given multiple business actions happen simultaneously
    When all events are recorded
    Then each event should be stored correctly
    And no events should be lost
    And the order of events should be preserved where it matters
