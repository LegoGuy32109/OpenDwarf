extends Node

# this will be fixed in next release
#const Constants = preload("res://Game/Creature/Organ.gd")
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}

# Function must be run after attaching organs together to autocomplete variables
func completeBody(brain: Organ) -> Body:
	var body = Body.new(brain, true)
	return body

# returns root of body, "brain" 🧠
func constructHuman() -> Organ:
	var brain = Organ.new("Brain", 0.00127387943212)
	var head = Organ.new("Head", 0.04119239747524)
	var eyeR = Organ.new("Right Eye", 0.0000923661064)
	var eyeL = Organ.new("Left Eye", 0.0000923661064)
	var earR = Organ.new("Right Ear", 0.00010917393956)
	var earL = Organ.new("Left Ear", 0.00010917393956)
	var mouth = Organ.new("Mouth", 0.00026071682805)
	var nose = Organ.new("Nose", 0.00007716972323)
	
	var neck = Organ.new("Neck", 0.00051674747374)
	var torsoU = Organ.new("Upper Torso", 0.07289374619722)
	var heart = Organ.new("Heart", 0.00061203143559)
	var lungR = Organ.new("Right Lung", 0.00409334106371)
	var lungL = Organ.new("Left Lung", 0.00409334525466)
	var stomach = Organ.new("Stomach", 0.00044758911827)
	var liver = Organ.new("Liver", 0.00147630751599)
	var spleen = Organ.new("Spleen", 0.00014384483802)
	var pancreas = Organ.new("Pancreas", 0.00009726657299)
	
	var armRU = Organ.new("Right Upper Arm", 0.00300435884856)
	var armRL = Organ.new("Right Lower Arm", 0.003882199293)
	var handR = Organ.new("Right Hand", 0.00218579918146)
	var thumbR = Organ.new("Right Thumb", 0.00009846345347)
	var fingerR1 = Organ.new("Finger", 0.00015331352188)
	var fingerR2 = Organ.new("Finger", 0.00015331352188)
	var fingerR3 = Organ.new("Finger", 0.00015331352188)
	var fingerR4 = Organ.new("Pinky", 0.00015331352188)
	
	var armLU = Organ.new("Left Upper Arm", 0.00300435884856)
	var armLL = Organ.new("Left Lower Arm", 0.003882199293)
	var handL = Organ.new("Left Hand", 0.00218579918146)
	var thumbL = Organ.new("Left Thumb", 0.00009846345347)
	var fingerL1 = Organ.new("Finger", 0.00015331352188)
	var fingerL2 = Organ.new("Finger", 0.00015331352188)
	var fingerL3 = Organ.new("Finger", 0.00015331352188)
	var fingerL4 = Organ.new("Pinky", 0.00015331352188)
	
	var torsoL = Organ.new("Lower Torso", 0.02879198081791)
	var kidneyL = Organ.new("Left Kidney", 0.00014577648835)
	var kidneyR = Organ.new("Right Kidney", 0.00013417842274)
	var guts = Organ.new("Guts", 0.00700118485838)
	
	var legRU = Organ.new("Right Upper Leg", 0.00600656634197)
	var legRL = Organ.new("Right Lower Leg", 0.00980964675546)
	var footR = Organ.new("Right Foot", 0.00232410663739)
	var toeR1 = Organ.new("Toe", 0.00002738583316)
	var toeR2 = Organ.new("Toe", 0.00002738583316)
	var toeR3 = Organ.new("Toe", 0.00002738583316)
	var toeR4 = Organ.new("Toe", 0.00002738583316)
	var toeR5 = Organ.new("Toe", 0.00002738583316)
	
	var legLU = Organ.new("Left Upper Leg", 0.00600656680763)
	var legLL = Organ.new("Left Lower Leg", 0.00980964768678)
	var footL = Organ.new("Left Foot", 0.00232410663739)
	var toeL1 = Organ.new("Toe", 0.00002738583316)
	var toeL2 = Organ.new("Toe", 0.00002738583316)
	var toeL3 = Organ.new("Toe", 0.00002738583316)
	var toeL4 = Organ.new("Toe", 0.00002738583316)
	var toeL5 = Organ.new("Toe", 0.00002738583316)
	
	# Brain, Neck, [Torso], [Arm], [Hand], [Leg], [Foot]
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
	
	# start connecting from root of the creature, the brain
	brain.isBrainOf(head, humanCritical)
	
	# each organ has it's own block of connecting other organs
	head.connectOrgan(eyeR, humanExtremity)
	head.connectOrgan(eyeL, humanExtremity)
	head.connectOrgan(earR, humanMayWiggle)
	head.connectOrgan(earL, humanMayWiggle)
	head.connectOrgan(nose, humanMayWiggle)
	head.connectOrgan(mouth, humanExtremity)
	head.connectOrgan(neck, humanCritical)
	
	neck.connectOrgan(torsoU, humanCritical)
	
	heart.isHeart = true
	torsoU.connectOrgan(heart, humanMuscleOrgan)
	torsoU.connectOrgan(lungR, humanMuscleOrgan)
	torsoU.connectOrgan(lungL, humanMuscleOrgan)
	torsoU.connectOrgan(stomach, humanOrgan)
	torsoU.connectOrgan(liver, humanOrgan)
	torsoU.connectOrgan(spleen, humanOrgan)
	torsoU.connectOrgan(pancreas, humanOrgan)
	torsoU.connectOrgan(armRU, humanCritical)
	torsoU.connectOrgan(armLU, humanCritical)
	torsoU.connectOrgan(torsoL, humanCritical)
	
	armRU.connectOrgan(armRL, humanCritical)
	
	armRL.connectOrgan(handR, humanCritical)
	
	handR.connectOrgan(thumbR, humanExtremity)
	handR.connectOrgan(fingerR1, humanExtremity)
	handR.connectOrgan(fingerR2, humanExtremity)
	handR.connectOrgan(fingerR3, humanExtremity)
	handR.connectOrgan(fingerR4, humanExtremity)
	
	armLU.connectOrgan(armLL, humanCritical)
	
	armLL.connectOrgan(handL, humanCritical)
	
	handL.connectOrgan(thumbL, humanExtremity)
	handL.connectOrgan(fingerL1, humanExtremity)
	handL.connectOrgan(fingerL2, humanExtremity)
	handL.connectOrgan(fingerL3, humanExtremity)
	handL.connectOrgan(fingerL4, humanExtremity)
	
	torsoL.connectOrgan(guts, humanMuscleOrgan)
	torsoL.connectOrgan(kidneyR, humanOrgan)
	torsoL.connectOrgan(kidneyL, humanOrgan)
	torsoL.connectOrgan(legRU, humanCritical)
	torsoL.connectOrgan(legLU, humanCritical)
	
	legRU.connectOrgan(legRL, humanCritical)
	
	legRL.connectOrgan(footR, humanCritical)

	footR.connectOrgan(toeR1, humanExtremity)
	footR.connectOrgan(toeR2, humanExtremity)
	footR.connectOrgan(toeR3, humanExtremity)
	footR.connectOrgan(toeR4, humanExtremity)
	footR.connectOrgan(toeR5, humanExtremity)
	
	legLU.connectOrgan(legLL, humanCritical)
	
	legLL.connectOrgan(footL, humanCritical)
	
	footL.connectOrgan(toeL1, humanExtremity)
	footL.connectOrgan(toeL2, humanExtremity)
	footL.connectOrgan(toeL3, humanExtremity)
	footL.connectOrgan(toeL4, humanExtremity)
	footL.connectOrgan(toeL5, humanExtremity)
	
	return brain

func _ready() -> void:
	print("\n==Starting Organ Test==\n")
	var humanBrain: Organ = constructHuman()
	
	var body = completeBody(humanBrain)
	var organs: Array[Organ] = body.getAllOrgans()
	organs.sort_custom(
		func(organA: Organ, organB: Organ): return organA.volume > organB.volume
	)
	for organ in organs:
		print("%s\n%s m^3\n%s cm^3" % [organ.name, organ.volume, organ.volume*1000000])

