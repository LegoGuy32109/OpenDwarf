# Open Dwarf vocabulary

- **World host:** The browser that owns and simulates a world.
- **Joining player:** A player who connects to a world host through the admin
  route. The route gives this player no special game rules.
- **Session:** The identity of one host world, used to find it and connect to it.
- **Visitor token:** The identity a joining player's tab presents when it
  reconnects to the same host world.
- **Move intent:** A requested direction with a sequence number. The host
  decides whether the move is valid.
- **Timed move:** A move from one whole tile to another with a start tick and
  duration. Browsers use it to draw smooth movement.
- **Presentation buffer:** A short visual delay applied to remote entities.
  It does not delay world simulation.
- **Phone test code:** A temporary code that lets a test runner send predefined
  diagnostic commands to a phone that opened the test route.
