extends Node

# this will be fixed in next release
#const Constants = preload("res://Game/Creature/Limb.gd")
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}

func getLimbData(limb: Limb, levelsDeep = 0) -> void:
	var depth = ""
	for i in range(levelsDeep):
		depth += "-"
	
	var isBrain = ""
	if(levelsDeep == 0):
		isBrain = "🧠"
	
	var isOrgan = ""
	if(limb.findIfOrgan()):
		isOrgan = "🫁"
	
	var isHeart = ""
	if(limb.isHeart):
		isHeart = "🫀"
	
	var needsBlood = ""
	var heartConnection: int = limb.connectedToHeart()
	if (heartConnection == ConnectionToHeart.CONNECTED):
		needsBlood = "🩸"
	
	print(depth+limb.name+" "+isBrain+isHeart+isOrgan+needsBlood)
	for connection in limb.connections:
		getLimbData(connection.linkTo, levelsDeep+1)

func _ready() -> void:
	print("\n==Starting Limb Test==\n")
	var brain = Limb.new("Brain")
	var head = Limb.new("Head")
	var eyeR = Limb.new("Right Eye")
	var eyeL = Limb.new("Left Eye")
	var earR = Limb.new("Right Ear")
	var earL = Limb.new("Left Ear")
	var mouth = Limb.new("Mouth")
	var nose = Limb.new("Nose")
	
	var neck = Limb.new("Neck")
	var torsoU = Limb.new("Upper Torso")
	var heart = Limb.new("Heart")
	var lungR = Limb.new("Right Lung")
	var lungL = Limb.new("Left Lung")
	var stomach = Limb.new("Stomach")
	var liver = Limb.new("Liver")
	var spleen = Limb.new("Spleen")
	var pancreas = Limb.new("Pancreas")
	
	var armRU = Limb.new("Right Upper Arm")
	var armRL = Limb.new("Right Lower Arm")
	var handR = Limb.new("Right Hand")
	var thumbR = Limb.new("Right Thumb")
	var fingerR1 = Limb.new("Finger")
	var fingerR2 = Limb.new("Finger")
	var fingerR3 = Limb.new("Finger")
	var fingerR4 = Limb.new("Pinky")
	
	var armLU = Limb.new("Left Upper Arm")
	var armLL = Limb.new("Left Lower Arm")
	var handL = Limb.new("Left Hand")
	var thumbL = Limb.new("Left Thumb")
	var fingerL1 = Limb.new("Finger")
	var fingerL2 = Limb.new("Finger")
	var fingerL3 = Limb.new("Finger")
	var fingerL4 = Limb.new("Pinky")
	
	var torsoL = Limb.new("Lower Torso")
	var kidneyL = Limb.new("Left Kidney")
	var kidneyR = Limb.new("Right Kidney")
	var guts = Limb.new("Guts")
	
	var legRU = Limb.new("Right Upper Leg")
	var legRL = Limb.new("Right Lower Leg")
	var footR = Limb.new("Right Foot")
	var toeR1 = Limb.new("Toe")
	var toeR2 = Limb.new("Toe")
	var toeR3 = Limb.new("Toe")
	var toeR4 = Limb.new("Toe")
	var toeR5 = Limb.new("Toe")
	
	var legLU = Limb.new("Left Upper Leg")
	var legLL = Limb.new("Left Lower Leg")
	var footL = Limb.new("Left Foot")
	var toeL1 = Limb.new("Toe")
	var toeL2 = Limb.new("Toe")
	var toeL3 = Limb.new("Toe")
	var toeL4 = Limb.new("Toe")
	var toeL5 = Limb.new("Toe")
	
	# Brain, Neck, [Torso], [Arm], Hand, [Leg], Foot
	var humanCritical = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
		"artery": 1.0,
	}
	# Eye, Mouth, Finger, Thumb, Toe
	var humanExtremity = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
	}
	# Ear, Nose
	var humanMayWiggle = {
		"tissue": 1.0,
		"muscle": 0.2, # influence by genetics or random chance
		"nerve": 1.0,
	}
	# Stomach, Liver, Spleen, Pancreas
	var humanOrgan = {
		"tissue": 1.0,
	}
	# Heart, Lung, Guts
	var humanMuscleOrgan = { 
		"tissue": 1.0,
		"muscle": 1.0,
		"artery": 1.0,
	}
	
	brain.isBrainOf(head, humanCritical)
	
	head.connectLimb(eyeR, humanExtremity)
	head.connectLimb(eyeL, humanExtremity)
	head.connectLimb(earR, humanMayWiggle)
	head.connectLimb(earL, humanMayWiggle)
	head.connectLimb(nose, humanMayWiggle)
	head.connectLimb(mouth, humanExtremity)
	head.connectLimb(neck, humanCritical)
	
	neck.connectLimb(torsoU, humanCritical)
	
	heart.isHeart = true
	torsoU.connectOrgan(heart, humanMuscleOrgan)
	torsoU.connectOrgan(lungR, humanMuscleOrgan)
	torsoU.connectOrgan(lungL, humanMuscleOrgan)
	torsoU.connectOrgan(stomach, humanOrgan)
	torsoU.connectOrgan(liver, humanOrgan)
	torsoU.connectOrgan(spleen, humanOrgan)
	torsoU.connectOrgan(pancreas, humanOrgan)
	torsoU.connectLimb(armRU, humanCritical)
	torsoU.connectLimb(armLU, humanCritical)
	torsoU.connectLimb(torsoL, humanCritical)
	
	armRU.connectLimb(armRL, humanCritical)
	
	armRL.connectLimb(handR, humanCritical)
	
	handR.connectLimb(thumbR, humanExtremity)
	handR.connectLimb(fingerR1, humanExtremity)
	handR.connectLimb(fingerR2, humanExtremity)
	handR.connectLimb(fingerR3, humanExtremity)
	handR.connectLimb(fingerR4, humanExtremity)
	
	armLU.connectLimb(armLL, humanCritical)
	
	armLL.connectLimb(handL, humanCritical)
	
	handL.connectLimb(thumbL, humanExtremity)
	handL.connectLimb(fingerL1, humanExtremity)
	handL.connectLimb(fingerL2, humanExtremity)
	handL.connectLimb(fingerL3, humanExtremity)
	handL.connectLimb(fingerL4, humanExtremity)
	
	torsoL.connectOrgan(guts, humanMuscleOrgan)
	torsoL.connectOrgan(kidneyR, humanOrgan)
	torsoL.connectOrgan(kidneyL, humanOrgan)
	torsoL.connectLimb(legRU, humanCritical)
	torsoL.connectLimb(legLU, humanCritical)
	
	legRU.connectLimb(legRL, humanCritical)
	
	legRL.connectLimb(footR, humanCritical)
	
	footR.connectLimb(toeR1, humanExtremity)
	footR.connectLimb(toeR2, humanExtremity)
	footR.connectLimb(toeR3, humanExtremity)
	footR.connectLimb(toeR4, humanExtremity)
	footR.connectLimb(toeR5, humanExtremity)
	
	legLU.connectLimb(legLL, humanCritical)
	
	legLL.connectLimb(footL, humanCritical)
	
	footL.connectLimb(toeL1, humanExtremity)
	footL.connectLimb(toeL2, humanExtremity)
	footL.connectLimb(toeL3, humanExtremity)
	footL.connectLimb(toeL4, humanExtremity)
	footL.connectLimb(toeL5, humanExtremity)
	
	getLimbData(brain)
	
	print(handR.connectedToHeart())
	print("Hey")

