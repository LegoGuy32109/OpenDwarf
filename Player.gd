extends CharacterBody2D

@export
var SPEED := 400.0

@onready
var navAgent = $NavAgent
		
func _physics_process(_delta):
	# I want to handle this wihin it's own function so I don't have to call it every frame
	if Input.is_action_pressed("click"):
		navAgent.set_target_location(get_global_mouse_position())
		
	var new_velocity : Vector2 = (navAgent.get_next_location() - global_transform.origin).normalized() * SPEED
	navAgent.set_velocity(new_velocity)
	

func _on_nav_agent_velocity_computed(safe_velocity : Vector2):
	if(navAgent.distance_to_target() > 5):
		set_velocity(safe_velocity)
		print(self.velocity)
		move_and_slide()
