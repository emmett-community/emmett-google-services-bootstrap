Feature: Reliable messaging
  As a service developer
  I want the events I publish to never be lost and the messages I receive to be handled once
  So that other services and my own subscribers stay consistent without extra code in each service

  Scenario: Publishing an event once it is stored
    Given the service publishes some of its event types through an outbox
    When an event of one of those types is recorded
    Then the event is published after it is stored
    And it is published with the same id as the stored event
    And nothing is left waiting to be published

  Scenario: Events that are not published stay in the service
    Given the service publishes some of its event types through an outbox
    When an event of another type is recorded
    Then the event is not published
    And nothing is stored to be published

  Scenario: A publication that failed is recovered
    Given the service publishes some of its event types through an outbox
    And the message broker is unavailable
    When an event of one of those types is recorded
    Then the event is stored and waits to be published
    When the broker is available again and the recovery job runs
    Then the event is published
    And nothing is left waiting to be published

  Scenario: The service still records its own data with every event
    Given the service publishes through an outbox and records something of its own whenever events are recorded
    When an event is recorded
    Then the event, the outbox entry and that record are stored together

  Scenario: Without an outbox nothing changes
    Given the service does not configure an outbox
    When an event is recorded
    Then nothing is published or stored to be published

  Scenario: A message delivered twice is handled once
    Given a subscriber handles its messages through the inbox of the service
    When the same message is delivered twice
    Then the events it records are stored once
    And the inbox shows the message as handled

  Scenario: The inbox record is stored with the events it caused
    Given a subscriber records events while handling a message
    When the events are recorded
    Then the inbox record of the message is stored in the same transaction
