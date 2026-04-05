import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Ethan
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = characters.find(c => c.name.toLowerCase().includes('ethan'));
    
    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Get all locations
    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Deep check on Ethan
    const check = {
      characterId: ethan.id,
      name: ethan.name,
      status: ethan.status,
      currentLocationId: ethan.current_location_id,
      currentLocationName: ethan.current_location_id ? locMap[ethan.current_location_id]?.name : null,
      currentHomeLocationId: ethan.current_home_location_id,
      currentHomeLocationName: ethan.current_home_location_id ? locMap[ethan.current_home_location_id]?.name : null,
      occupationLocationId: ethan.occupation_location_id,
      occupationLocationName: ethan.occupation_location_id ? locMap[ethan.occupation_location_id]?.name : null,
      currentActivity: ethan.current_activity,
      emotionalState: ethan.emotional_state,
      sleepStartTime: ethan.sleep_start_time,
      wakeUpTime: ethan.wake_up_time,
      workStartTime: ethan.work_start_time,
      workEndTime: ethan.work_end_time,
      workDays: ethan.work_days,
      decidedToStayUpUntil: ethan.decided_to_stay_up_until,
    };

    // Check sleep logic
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const sleepTimes = ethan.sleep_start_time ? ethan.sleep_start_time.split(':').map(Number) : null;
    const wakeTimes = ethan.wake_up_time ? ethan.wake_up_time.split(':').map(Number) : null;
    
    let isSleeping = false;
    if (sleepTimes && wakeTimes) {
      const sleepTime = sleepTimes[0] * 60 + sleepTimes[1];
      const wakeTime = wakeTimes[0] * 60 + wakeTimes[1];
      if (sleepTime > wakeTime) {
        isSleeping = currentTime >= sleepTime || currentTime < wakeTime;
      } else {
        isSleeping = currentTime >= sleepTime && currentTime < wakeTime;
      }
    }

    // Check work logic
    const workTimes = ethan.work_start_time ? ethan.work_start_time.split(':').map(Number) : null;
    const workEndTimes = ethan.work_end_time ? ethan.work_end_time.split(':').map(Number) : null;
    const dayOfWeek = now.getDay();
    
    let atWork = false;
    if (workTimes && workEndTimes && ethan.work_days) {
      const workStart = workTimes[0] * 60 + workTimes[1];
      const workEnd = workEndTimes[0] * 60 + workEndTimes[1];
      atWork = ethan.work_days.includes(dayOfWeek) && currentTime >= workStart && currentTime < workEnd;
    }

    check.sleepLogic = {
      isSleeping,
      currentTime: `${Math.floor(currentTime / 60)}:${String(currentTime % 60).padStart(2, '0')}`,
      sleepWindow: sleepTimes ? `${sleepTimes[0]}:${String(sleepTimes[1]).padStart(2, '0')} - ${wakeTimes[0]}:${String(wakeTimes[1]).padStart(2, '0')}` : 'Not set',
    };

    check.workLogic = {
      atWork,
      currentDayOfWeek: dayOfWeek,
      workWindow: workTimes ? `${workTimes[0]}:${String(workTimes[1]).padStart(2, '0')} - ${workEndTimes[0]}:${String(workEndTimes[1]).padStart(2, '0')}` : 'Not set',
      workDays: ethan.work_days || [],
    };

    // Check what status display logic should show
    const shouldShowHome = !isSleeping && !atWork;
    const activityIndicatesHome = ethan.current_activity?.toLowerCase().includes('home') || 
                                   ethan.current_activity?.toLowerCase().includes('bed') ||
                                   ethan.current_activity?.toLowerCase().includes('apartment');

    check.statusLogic = {
      shouldShowHome,
      activityIndicatesHome,
      reasonShowingHome: isSleeping ? 'sleeping' : atWork ? 'at work' : 'default/home',
      hasExplicitLocation: !!ethan.current_location_id,
      explicitLocationOverridesOther: 'YES - should use current_location_id if set',
    };

    // Get conversation count
    const convs = await base44.entities.Conversation.filter({ character_ids: [ethan.id] });
    check.conversationCount = convs.length;

    return Response.json({
      timestamp: new Date().toISOString(),
      ethanDiagnostics: check,
      homeLocationData: check.currentHomeLocationId ? locMap[check.currentHomeLocationId] : null,
      workLocationData: check.occupationLocationId ? locMap[check.occupationLocationId] : null,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});