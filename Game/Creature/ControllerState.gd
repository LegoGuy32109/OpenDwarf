## Fed to controlled creatures
class_name ControllerState

var moveVector: Vector2i = Vector2i(0, 0) 
var reachVector: Vector2i = Vector2i(0, 0) 
var sprintHeld: bool = false
var crouchHeld: bool = false
var selectHeld: bool = false

func _to_string() -> String:
    var output = ""
    output += "moveVector: %s\n" % moveVector
    output += "reachVector: %s\n" % reachVector
    output += "sprintHeld: %s\n" % sprintHeld
    output += "crouchHeld: %s\n" % crouchHeld
    output += "selectHeld: %s\n" % selectHeld
    return output