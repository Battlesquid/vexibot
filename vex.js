const { MessageEmbed } = require('discord.js');
const { decode } = require('he');

const { client, db } = require('./app');
const dbinfo = require('./dbinfo');

const getTeamId = (message, args) => {
	const arg = args.replace(/\s+/g, '');
	if (arg) {
		return arg.toUpperCase();
	}
	return (message.member ? message.member.displayName : message.author.username).split(' | ', 2)[1];
};

const validTeamId = teamId => /^([0-9]{1,5}[A-Z]?|[A-Z]{2,5}[0-9]{0,2})$/i.test(teamId);

const getTeam = (teamId, season) => {
	let query = {
		'_id.id': new RegExp(`^${teamId}$`, 'i'),
		'_id.prog': (isNaN(teamId.charAt(0)) ? 4 : 1)
	};
	const teams = db.collection('teams');
	if (season != null) {
		query['_id.season'] = season;
		return teams.findOne(query);
	}
	return teams.find(query).sort({'_id.season': -1}).toArray();
};

const getTeamLocation = team => {
	let location = [team.city];
	if (team.region) {
		location.push(team.region);
	}
	if (team.country) {
		location.push(team.country);
	}
	return location.join(', ');
};

const createTeamEmbed = team => {
	const teamId = team._id.id;
	const program = dbinfo.decodeProgram(team._id.prog);
	const season = team._id.season;
	const location = getTeamLocation(team);
	const embed = new MessageEmbed()
		.setColor('GREEN')
		.setAuthor(teamId, dbinfo.emojiToUrl(dbinfo.decodeProgramEmoji(team._id.prog)), `https://robotevents.com/teams/${program}/${teamId}`)
		.setTitle(dbinfo.decodeSeason(season))
		.setURL(dbinfo.decodeSeasonUrl(season));
	if (team.name) {
		embed.addField('Team Name', team.name, true);
	}
	if (team.robot) {
		embed.addField('Robot Name', team.robot, true);
	}
	if (team.org) {
		embed.addField('Organization', team.org, true);
	}
	if (location) {
		embed.addField('Location', location, true);
	}
	if (team.grade) {
		embed.addField('Grade', dbinfo.decodeGrade(team.grade), true);
	}
	return embed;
};

const createEventEmbed = event => {
	const embed = new MessageEmbed()
		.setColor('ORANGE')
		.setAuthor(event.name, dbinfo.emojiToUrl(dbinfo.decodeProgramEmoji(event.prog)), `https://robotevents.com/${event._id}.html`)
		.setTitle(`${event.tsa ? 'TSA ' : ''}${dbinfo.decodeSeason(event.season)}`)
		.setURL(dbinfo.decodeSeasonUrl(event.season))
		.setDescription(event.type)
		.setTimestamp(new Date(event.start))
		.addField('Capacity', `${event.size}/${event.capacity}`, true)
		.addField('Price', `$${parseFloat(event.cost / 100).toFixed(2)}`, true)
		.addField('Grade', dbinfo.decodeGrade(event.grade), true)
		.addField('Skills Offered?', event.skills ? 'Yes' : 'No', true);
	return embed;
};

const maskedTeamUrl = (program, teamId) => `[${teamId}](https://robotevents.com/teams/${dbinfo.decodeProgram(program)}/${teamId})`;

const createMatchString = (round, instance, number) => `${dbinfo.decodeRound(round)}${round < 3 || round > 8 ? '' : ` ${instance}-`}${number}`;

const createTeamsString = (prog, teams, teamSit, scored) => {
	teams = teams.filter(team => team);
	return teams.map(team => {
		const program = isNaN(team.charAt(0)) ? 4 : prog;
		const teamLink = maskedTeamUrl(program, team);
		if (!scored) {
			return teamLink;
		}
		if (teams.length > 2 && team === teamSit) {
			return `*${teamLink}*`;
		}
		return `**${teamLink}**`;
	}).join(' ');
};

const allianceEmojis = ['🔴', '🔵'];
const matchScoredEmojis = ['👍', '👎'];

const matchScoredNotification = match => {
	const matchString = createMatchString(match._id.round, match._id.instance, match._id.number);
	const redTeams = [match.red, match.red2, match.red3].filter(team => team && team !== match.redSit);
	const blueTeams = [match.blue, match.blue2, match.blue3].filter(team => team && team !== match.blueSit);
	return `${matchString} ${redTeams[0]}${redTeams[1] ? ` ${redTeams[1]}` : ''}${allianceEmojis[0]}${match.redScore}-${match.blueScore}${allianceEmojis[1]}${blueTeams[1] ? `${blueTeams[1]} ` : ''}${blueTeams[0]}`;
};

const createMatchEmbed = match => {
	let color;
	if (!match.hasOwnProperty('redScore')) {
		color = 0xffffff;
	} else if (match.prog === 41) {
		color = 'BLUE';
	} else if (match.redScore === match.blueScore) {
		color = 'GREY';
	} else {
		color = (match.redScore > match.blueScore) ? 'RED' : 'BLUE';
	}
	let red = `${allianceEmojis[0]} Red`;
	let blue = `${allianceEmojis[1]} Blue`;
	if (match.hasOwnProperty('redScore') || match.hasOwnProperty('redScorePred')) {
		red += ':';
		blue += ':';
		if (match.hasOwnProperty('redScore')) {
			red += ` ${match.redScore}`;
			blue += ` ${match.blueScore}`;
		}
		if (match.hasOwnProperty('redScorePred')) {
			red += ` (${match.redScorePred} predicted)`;
			blue += ` (${match.blueScorePred} predicted)`;
		}
	}
	const embed = new MessageEmbed()
		.setColor(color)
		.setAuthor(match._id.event.name, null, `https://robotevents.com/${match._id.event._id}.html`)
		.setTitle(match._id.division)
		.setURL(`https://robotevents.com/${match._id.event._id}.html#tab-results`)
		.setDescription(createMatchString(match._id.round, match._id.instance, match._id.number))
		.addField(red, createTeamsString(match.prog, [match.red, match.red2, match.red3], match.redSit), true)
		.addField(blue, createTeamsString(match.prog, [match.blue, match.blue2, match.blue3], match.blueSit), true);
	if (match.hasOwnProperty('start')) {
		embed.setTimestamp(new Date(match.start));
	}
	return embed;
};

const createAwardEmbed = async award => {
	const skus = award.qualifies ? award.qualifies.slice() : [];
	skus.unshift(award._id.event);
	const events = await db.collection('events').find({_id: {$in: skus}}).project({_id: 1, name: 1}).toArray();
	let eventName;
	events.forEach(event => {
		if (event._id === award._id.event) {
			eventName = event.name;
		} else {
			award.qualifies[award.qualifies.indexOf(event._id)] = `[${event.name}](https://robotevents.com/${event._id}.html)`;
		}
	});
	const embed = new MessageEmbed()
		.setColor('PURPLE')
		.setAuthor(eventName)
		.setTitle(award._id.name)
		.setURL(`https://robotevents.com/${award._id.event}.html#tab-awards`);
	if (award.team) {
		embed.addField('Team', `${dbinfo.decodeProgramEmoji(award.team.prog)} [${award.team.id}](https://robotevents.com/teams/${dbinfo.decodeProgram(award.team.prog)}/${award.team.id})`, true);
	}
	if (award.qualifies) {
		embed.addField('Qualifies for', award.qualifies.join('\n'), true);
	}
	return embed;
};

const createSkillsEmbed = async skill => {
	let embed;
	try {
		const event = await db.collection('events').findOne({_id: skill._id.event});
		const program = dbinfo.decodeProgram(skill.team.prog);
		embed = new MessageEmbed()
			.setColor('GOLD')
			.setAuthor(event.name, null, `https://robotevents.com/${event._id}.html#tab-results`)
			.setTitle(`${program} ${skill.team.id}`)
			.setURL(`https://robotevents.com/teams/${program}/${skill.team.id}`)
			.addField('Type', dbinfo.decodeSkill(skill._id.type), true)
			.addField('Rank', skill.rank, true)
			.addField('Score', skill.score, true)
			.addField('Attempts', skill.attempts, true);
	} catch (err) {
		console.error(err);
	}
	return embed;
};

const getMatchTeams = match => [match.red, match.red2, match.red3, match.blue, match.blue2, match.red3].filter(team => team).map(team => {
	return {prog: (isNaN(team.charAt(0)) ? 4 : match._id.event.prog), id: team};
});

const sendMatchEmbed = async (content, match, reactions) => {
	try {
		match._id.event = await db.collection('events').findOne({_id: match._id.event});
		await sendToSubscribedChannels((match.hasOwnProperty('redScore') ? `${matchScoredNotification(match)}\n${content}` : content), {embed: createMatchEmbed(match)}, getMatchTeams(match), reactions);
	} catch (err) {
		console.error(err);
	}
};

const subscribedChannels = [
	'352003193666011138',
	//'329477820076130306'  // Dev server.
];

const sendToSubscribedChannels = async (content, options, teams = [], reactions = []) => {
	subscribedChannels.forEach(async id => {
		const channel = client.channels.get(id);
		if (channel) {
			try {
				let subscribers = [];
				for (let team of teams) {
					const teamSubs = await db.collection('teamSubs').find({_id: {guild: channel.guild.id, team: team}}).toArray();
					for (let teamSub of teamSubs) {
						for (let user of teamSub.users) {
							if (subscribers.indexOf(user) < 0) {
								subscribers.push(user);
							}
						}
					}
				}
				let text;
				if (subscribers.length) {
					text = subscribers.map(subscriber => `<@${subscriber}>`).join('');
				}
				if (content) {
					text = text ? `${content}\n${text}` : content;
				}
				const message = await channel.send(text ? text : undefined, options).catch(console.error);
				for (let reaction of reactions) {
					await message.react(reaction);
				}
			} catch (err) {
				console.error(err);
			}
		}
	});
};

const escapeMarkdown = string => string ? string.replace(/([*^_`~])/g, '\\$1') : '';

const createTeamChangeEmbed = (prog, teamId, field, oldValue, newValue) => {
	const program = dbinfo.decodeProgram(prog);
	let change;
	if (!oldValue) {
		change = `added their ${field} **"**${escapeMarkdown(decode(newValue))}**"**`;
	} else if (!newValue) {
		change = `removed their ${field} **"**${escapeMarkdown(decode(oldValue))}**"**`;
	} else {
		change = `changed their ${field} from **"**${escapeMarkdown(decode(oldValue))}**"** to **"**${escapeMarkdown(decode(newValue))}**"**`;
	}
	return new MessageEmbed()
		.setColor('GREEN')
		.setDescription(`[${program} ${teamId}](https://robotevents.com/teams/${program}/${teamId}) ${change}.`);
};

module.exports = {
	getTeamId,
	validTeamId,
	getTeam,
	getTeamLocation,
	createTeamEmbed,
	createEventEmbed,
	createMatchEmbed,
	createSkillsEmbed,
	createAwardEmbed,
	createTeamChangeEmbed,
	sendToSubscribedChannels,
	sendMatchEmbed,
	allianceEmojis,
	matchScoredEmojis
};
